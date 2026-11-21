import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { parseAdsCsv } from '../costs/ads-csv';

export interface AdsSummary {
  total: string;
  unallocated: string; // gasto sem SKU associado
  bySku: Array<{ sku: string; amount: string }>;
}

/** Custos de ADS (publicidade). Importação manual de CSV; leitura por SKU e período. Nunca altera o Mercado Livre. */
@Injectable()
export class AdsService {
  constructor(private readonly prisma: PrismaService) {}

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
