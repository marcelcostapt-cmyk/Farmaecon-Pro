import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { parseAdsCsv, summarizeAdsRows, type AdsCsvSummary } from '../costs/ads-csv';
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

  /**
   * Pré-visualização SEM gravar: valida tudo, resume e avisa sobre duplicação.
   * Um ficheiro já importado (mesmo hash) não duplica linhas; um ficheiro diferente
   * com linhas no mesmo período é avisado, porque pode ser a mesma informação re-exportada.
   */
  async preview(tenantId: string, accountId: string, csvText: string, sourceHash: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Conta não encontrada.');
    const parsed = parseAdsCsv(csvText);
    const warnings: string[] = [];
    if (parsed.errors.length > 0) {
      return { valid: false as const, errors: parsed.errors, summary: null, warnings, sourceHash, alreadyImported: false, overlappingRows: 0 };
    }
    const summary: AdsCsvSummary = summarizeAdsRows(parsed.rows);
    const alreadyImported = (await this.prisma.adsCost.count({ where: { tenantId, marketplaceAccountId: accountId, sourceHash } })) > 0;
    let overlappingRows = 0;
    if (summary.firstDay && summary.lastDay && !alreadyImported) {
      overlappingRows = await this.prisma.adsCost.count({
        where: {
          tenantId,
          marketplaceAccountId: accountId,
          day: { gte: new Date(`${summary.firstDay}T00:00:00.000Z`), lte: new Date(`${summary.lastDay}T00:00:00.000Z`) },
        },
      });
    }
    if (alreadyImported) warnings.push('Este ficheiro já foi importado. Nenhuma linha será duplicada.');
    if (overlappingRows > 0) {
      warnings.push(`Já existem ${overlappingRows} linha(s) de outro ficheiro neste período. Confirme que não é a mesma informação re-exportada, para evitar duplicar o investimento.`);
    }
    return { valid: true as const, errors: [], summary, warnings, sourceHash, alreadyImported, overlappingRows };
  }

  async importCsv(tenantId: string, accountId: string, csvText: string, sourceHash: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Conta não encontrada.');

    const parsed = parseAdsCsv(csvText);
    if (parsed.errors.length > 0) {
      throw new BadRequestException(`Ficheiro rejeitado (${parsed.errors.length} erro(s)): ${parsed.errors.slice(0, 10).join(' ')}`);
    }
    // Idempotente: reimportar o mesmo ficheiro não duplica linhas (chave: hash do ficheiro + linha).
    const result = await this.prisma.adsCost.createMany({
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
    return { received: parsed.rows.length, imported: result.count, skipped: parsed.rows.length - result.count };
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
