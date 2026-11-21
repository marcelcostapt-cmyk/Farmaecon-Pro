import { Prisma } from '@prisma/client';
import type { MarginOrderRow } from './margin-preview';

export interface FeeChange {
  sku: string;
  description: string | null;
  fromMonth: string; // YYYY-MM
  toMonth: string; // YYYY-MM
  fromRatePercent: Prisma.Decimal; // taxa efetiva ML = Σ saleFee / Σ receita × 100
  toRatePercent: Prisma.Decimal;
  deltaPp: Prisma.Decimal; // to − from, em pontos percentuais
}

export const DEFAULT_FEE_CHANGE_PP = 2;

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

interface Bucket {
  fees: Prisma.Decimal;
  revenue: Prisma.Decimal;
  description: string | null;
}

/**
 * Alerta de mudança de tarifa ML por SKU. Compara a taxa efetiva (saleFee/receita) dos dois
 * últimos meses COM dados de taxa. Só usa itens com saleFee (nunca estima taxa em falta).
 * Devolve apenas variações com |Δ| ≥ thresholdPp. Puro: não lê a BD nem chama o ML.
 */
export function computeFeeChanges(rows: MarginOrderRow[], thresholdPp = DEFAULT_FEE_CHANGE_PP): FeeChange[] {
  const bySku = new Map<string, Map<string, Bucket>>();
  for (const row of rows) {
    const month = monthKey(row.soldAt ?? new Date(0));
    for (const item of row.items) {
      if (!item.sku || item.saleFee === null) continue;
      const revenue = item.unitPrice.times(item.quantity);
      if (revenue.isZero()) continue;
      const months = bySku.get(item.sku) ?? new Map<string, Bucket>();
      const b = months.get(month) ?? { fees: new Prisma.Decimal(0), revenue: new Prisma.Decimal(0), description: item.description };
      b.fees = b.fees.plus(item.saleFee);
      b.revenue = b.revenue.plus(revenue);
      months.set(month, b);
      bySku.set(item.sku, months);
    }
  }

  const changes: FeeChange[] = [];
  for (const [sku, months] of bySku) {
    const sorted = [...months.keys()].sort();
    if (sorted.length < 2) continue;
    const fromMonth = sorted[sorted.length - 2];
    const toMonth = sorted[sorted.length - 1];
    const from = months.get(fromMonth)!;
    const to = months.get(toMonth)!;
    const fromRate = from.fees.div(from.revenue).times(100);
    const toRate = to.fees.div(to.revenue).times(100);
    const delta = toRate.minus(fromRate);
    if (delta.abs().lt(thresholdPp)) continue;
    changes.push({
      sku,
      description: to.description ?? from.description,
      fromMonth,
      toMonth,
      fromRatePercent: fromRate,
      toRatePercent: toRate,
      deltaPp: delta,
    });
  }
  return changes.sort((a, b) => b.deltaPp.abs().comparedTo(a.deltaPp.abs()));
}
