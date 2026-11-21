import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { parseAdsCsv, summarizeAdsRows, type AdsCsvSummary } from '../costs/ads-csv';
import { findOverlap, OVERLAP_SAMPLE_SIZE, type OverlapMatch } from '../costs/ads-overlap';
import type { AdsProfile } from '../agents/giro-ads/ads-analysis';

export interface AdsSummary {
  total: string;
  unallocated: string; // gasto sem SKU associado
  bySku: Array<{ sku: string; amount: string }>;
}

/** Custos de ADS (publicidade). Importação manual de CSV; leitura por SKU e período. Nunca altera o Mercado Livre. */
@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Linhas já importadas da conta, de OUTROS ficheiros, no período do ficheiro novo. Só leitura. */
  private async existingInPeriod(tenantId: string, accountId: string, firstDay: string, lastDay: string, sourceHash: string) {
    const rows = await this.prisma.adsCost.findMany({
      where: {
        tenantId,
        marketplaceAccountId: accountId,
        sourceHash: { not: sourceHash },
        day: { gte: new Date(`${firstDay}T00:00:00.000Z`), lte: new Date(`${lastDay}T00:00:00.000Z`) },
      },
      select: { day: true, sku: true, campaign: true, amount: true, sourceHash: true, sourceLine: true },
    });
    return rows.map((r) => ({
      line: r.sourceLine,
      day: r.day.toISOString().slice(0, 10),
      sku: r.sku,
      campaign: r.campaign,
      amount: new Prisma.Decimal(r.amount),
      sourceHash: r.sourceHash,
    }));
  }

  /**
   * Pré-visualização SEM gravar: valida tudo, resume e identifica possível sobreposição com
   * despesas de OUTROS ficheiros da mesma conta. Um ficheiro já importado (mesmo hash) não é sobreposição:
   * a importação é idempotente. Sobreposição exige confirmação explícita do ADMIN para importar.
   */
  async preview(tenantId: string, accountId: string, csvText: string, sourceHash: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    const parsed = parseAdsCsv(csvText);
    if (parsed.errors.length > 0) {
      return { valid: false as const, errors: parsed.errors, summary: null, warnings: [], sourceHash, alreadyImported: false, overlap: null, requiresConfirmation: false };
    }
    const summary: AdsCsvSummary = summarizeAdsRows(parsed.rows);
    const alreadyImported = (await this.prisma.adsCost.count({ where: { tenantId, marketplaceAccountId: accountId, sourceHash } })) > 0;
    const warnings: string[] = [];
    let overlap: null | { count: number; amount: string; matches: OverlapMatch[]; sampleSize: number } = null;
    if (summary.firstDay && summary.lastDay) {
      const existing = await this.existingInPeriod(tenantId, accountId, summary.firstDay, summary.lastDay, sourceHash);
      const found = findOverlap(parsed.rows, existing);
      overlap = { count: found.count, amount: found.amount, matches: found.matches.slice(0, OVERLAP_SAMPLE_SIZE), sampleSize: OVERLAP_SAMPLE_SIZE };
    }
    if (alreadyImported) warnings.push('Este ficheiro já foi importado. Nenhuma linha será duplicada.');
    if (overlap && overlap.count > 0) {
      warnings.push(
        `${overlap.count} linha(s), no valor de ${overlap.amount}, coincidem com despesas já importadas de outro ficheiro desta conta. ` +
          'Se forem a mesma despesa re-exportada, importar duplicaria o investimento. Só importe se confirmar que são despesas distintas.',
      );
    }
    return {
      valid: true as const,
      errors: [],
      summary,
      warnings,
      sourceHash,
      alreadyImported,
      overlap,
      requiresConfirmation: !!overlap && overlap.count > 0 && !alreadyImported,
    };
  }

  /**
   * Importação. Ficheiro já importado: idempotente (0 novas). Sobreposição com outro ficheiro:
   * recusada sem confirmação explícita (409 OVERLAP_CONFIRMATION_REQUIRED). Com confirmação, grava
   * as linhas e a auditoria na mesma transação. Nunca elimina linhas com valores iguais.
   */
  async importCsv(
    tenantId: string,
    accountId: string,
    csvText: string,
    sourceHash: string,
    options: { confirmOverlap?: boolean; fileName?: string | null; requestedBy?: string | null } = {},
  ) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Conta não encontrada.');

    const parsed = parseAdsCsv(csvText);
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`Ficheiro rejeitado (${parsed.errors.length} erro(s)): ${parsed.errors.slice(0, 10).join(' ')}`);
    }
    // Ficheiro já importado (mesmo hash): idempotente. Não é sobreposição nem exige confirmação.
    const alreadyImported = (await this.prisma.adsCost.count({ where: { tenantId, marketplaceAccountId: accountId, sourceHash } })) > 0;
    let overlapCount = 0;
    if (!alreadyImported && parsed.rows.length > 0) {
      const days = parsed.rows.map((r) => r.day).sort();
      const existing = await this.existingInPeriod(tenantId, accountId, days[0], days[days.length - 1], sourceHash);
      overlapCount = findOverlap(parsed.rows, existing).count;
    }
    if (overlapCount > 0 && !options.confirmOverlap) {
      throw new ConflictException({
        code: 'OVERLAP_CONFIRMATION_REQUIRED',
        message: `${overlapCount} linha(s) coincidem com despesas já importadas de outro ficheiro. Confirme explicitamente para importar.`,
        overlapCount,
      });
    }
    const overlapConfirmed = overlapCount > 0 && options.confirmOverlap === true;

    return this.prisma.$transaction(async (tx) => {
      // Idempotente por (conta, hash, linha): reimportar o mesmo ficheiro não duplica.
      const result = await tx.adsCost.createMany({
        data: parsed.rows.map((r) => ({
          tenantId,
          marketplaceAccountId: accountId,
          day: new Date(`${r.day}T00:00:00.000Z`),
          sku: r.sku,
          campaign: r.campaign,
          amount: r.amount,
          sourceHash,
          sourceLine: r.line,
        })),
        skipDuplicates: true,
      });
      const outcome = {
        received: parsed.rows.length,
        imported: result.count,
        skipped: parsed.rows.length - result.count,
        overlapCount,
        overlapConfirmed,
      };
      await tx.adsImportBatch.create({
        data: {
          tenantId,
          marketplaceAccountId: accountId,
          sourceHash,
          fileName: options.fileName ?? null,
          rowsReceived: outcome.received,
          rowsImported: outcome.imported,
          rowsSkipped: outcome.skipped,
          overlapCount,
          overlapConfirmed,
          requestedBy: options.requestedBy ?? null,
        },
      });
      return outcome;
    });
  }

  /**
   * Perfil dos custos de ADS importados de UMA conta (para o agente Giro Ads). Só leitura.
   * Período e origem vêm das próprias linhas; nada é estimado.
   */
  async profile(tenantId: string, accountId: string): Promise<AdsProfile> {
    const rows = await this.prisma.adsCost.findMany({
      where: { tenantId, marketplaceAccountId: accountId },
      select: { day: true, sku: true, campaign: true, amount: true, sourceHash: true },
    });
    let total = new Prisma.Decimal(0);
    let unallocated = new Prisma.Decimal(0);
    const bySku = new Map<string, Prisma.Decimal>();
    const byCampaign = new Map<string, Prisma.Decimal>();
    const batches = new Set<string>();
    let first: Date | null = null;
    let last: Date | null = null;
    for (const r of rows) {
      const amount = new Prisma.Decimal(r.amount);
      total = total.plus(amount);
      batches.add(r.sourceHash);
      if (!first || r.day < first) first = r.day;
      if (!last || r.day > last) last = r.day;
      if (r.sku === null) unallocated = unallocated.plus(amount);
      else bySku.set(r.sku, (bySku.get(r.sku) ?? new Prisma.Decimal(0)).plus(amount));
      const campaign = r.campaign ?? '(sem campanha)';
      byCampaign.set(campaign, (byCampaign.get(campaign) ?? new Prisma.Decimal(0)).plus(amount));
    }
    const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
    return {
      rows: rows.length,
      firstDay: iso(first),
      lastDay: iso(last),
      importBatches: batches.size,
      total,
      unallocated,
      bySku: [...bySku.entries()].map(([sku, amount]) => ({ sku, amount })),
      byCampaign: [...byCampaign.entries()].map(([campaign, amount]) => ({ campaign, amount })),
    };
  }

  async summary(tenantId: string, accountId: string, start?: Date, end?: Date): Promise<AdsSummary> {
    const rows = await this.prisma.adsCost.findMany({
      where: {
        tenantId,
        marketplaceAccountId: accountId,
        ...(start || end ? { day: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {}),
      },
      select: { sku: true, amount: true },
    });
    const bySku = new Map<string, Prisma.Decimal>();
    let unallocated = new Prisma.Decimal(0);
    let total = new Prisma.Decimal(0);
    for (const r of rows) {
      const amount = new Prisma.Decimal(r.amount);
      total = total.plus(amount);
      if (r.sku === null) {
        unallocated = unallocated.plus(amount);
      } else {
        bySku.set(r.sku, (bySku.get(r.sku) ?? new Prisma.Decimal(0)).plus(amount));
      }
    }
    return {
      total: total.toString(),
      unallocated: unallocated.toString(),
      bySku: [...bySku.entries()]
        .sort(([, a], [, b]) => b.comparedTo(a))
        .map(([sku, amount]) => ({ sku, amount: amount.toString() })),
    };
  }
}
