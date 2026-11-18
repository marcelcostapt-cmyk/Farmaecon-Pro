import { Prisma } from '@prisma/client';
import { money } from './cost-money';
import {
  resolveCostCandidate,
  type CostPoolEntry,
  type MatchStrategy,
  type OrderItemForMatch,
} from './cost-matching';

const ZERO = money('0');

export type GroupBy = 'day' | 'month' | 'product';

export interface DreOrderRow {
  accountId: string;
  date: Date;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  revenue: Prisma.Decimal;
}

export interface DrePreviewLine {
  date: string | null;
  account_id: string | null;
  product_ean: string | null;
  product_description: string | null;
  quantity_sold: Prisma.Decimal;
  revenue: Prisma.Decimal;
  cost_status: 'approved' | 'estimated' | 'unavailable' | 'mixed';
  unit_cost_indicativo: Prisma.Decimal | null;
  cmv_indicativo: Prisma.Decimal | null;
  cmv_estimado_min: Prisma.Decimal | null;
  cmv_estimado_max: Prisma.Decimal | null;
  lucro_bruto: Prisma.Decimal | null;
  margem: Prisma.Decimal | null;
}

export interface DrePreview {
  status: 'preview';
  period: { start: string | null; end: string | null };
  summary: {
    receita_total: Prisma.Decimal;
    cmv_total_estimado_min: Prisma.Decimal | null;
    cmv_total_estimado_max: Prisma.Decimal | null;
    cmv_total_indicativo: Prisma.Decimal | null;
    lucro_bruto: Prisma.Decimal | null;
    margem_bruta: Prisma.Decimal | null;
    itens_indisponiveis: number;
    itens_estimados: number;
    itens_aprovados: number;
  };
  lines: DrePreviewLine[];
}

interface RowCost {
  status: 'approved' | 'estimated' | 'unavailable';
  cmvIndicativo: Prisma.Decimal | null; // custo único × qty
  min: Prisma.Decimal | null;
  max: Prisma.Decimal | null;
}

function rowCost(row: DreOrderRow, pool: CostPoolEntry[], strategy: MatchStrategy): RowCost {
  const r = resolveCostCandidate(
    { ean: row.ean, marketplaceSku: row.marketplaceSku, description: row.description, quantity: row.quantity, soldAt: row.date } as OrderItemForMatch,
    pool,
    strategy,
  );
  if (r.entry === null) return { status: 'unavailable', cmvIndicativo: null, min: null, max: null };
  const totals = r.entry.candidates
    .map((c) => (c.unitCost === null ? null : c.unitCost.times(row.quantity)))
    .filter((x): x is Prisma.Decimal => x !== null);
  const min = totals.length ? totals.reduce((a, b) => (b.lt(a) ? b : a)) : null;
  const max = totals.length ? totals.reduce((a, b) => (b.gt(a) ? b : a)) : null;
  const single = r.entry.candidates.length === 1 && r.entry.candidates[0].unitCost !== null;
  const cmvIndicativo = single ? r.entry.candidates[0].unitCost!.times(row.quantity) : null;
  return { status: r.status, cmvIndicativo, min, max };
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

/** Demonstração do DRE em modo preview. Nada é persistido; totais ambíguos ficam null/range. */
export function computeDrePreview(
  rows: DreOrderRow[],
  pool: CostPoolEntry[],
  strategy: MatchStrategy,
  groupBy: GroupBy,
): DrePreview {
  const groups = new Map<string, { rows: DreOrderRow[]; costs: RowCost[] }>();
  let indisponiveis = 0;
  let estimados = 0;
  let aprovados = 0;

  for (const row of rows) {
    const rc = rowCost(row, pool, strategy);
    if (rc.status === 'unavailable') indisponiveis++;
    else if (rc.status === 'approved') aprovados++;
    else estimados++;

    const bucket = groupBy === 'day' ? dayKey(row.date) : groupBy === 'month' ? monthKey(row.date) : null;
    const key =
      groupBy === 'product'
        ? `${row.ean ?? row.description ?? 'sem-id'}`
        : `${bucket}|${row.accountId}|${row.ean ?? row.description ?? 'sem-id'}`;
    const g = groups.get(key) ?? groups.set(key, { rows: [], costs: [] }).get(key)!;
    g.rows.push(row);
    g.costs.push(rc);
  }

  const lines: DrePreviewLine[] = [];
  for (const { rows: gr, costs } of groups.values()) {
    const quantity = gr.reduce((s, r) => s.plus(r.quantity), ZERO);
    const revenue = gr.reduce((s, r) => s.plus(r.revenue), ZERO);
    const first = gr[0];
    const statuses = new Set(costs.map((c) => c.status));
    const status: DrePreviewLine['cost_status'] = statuses.size === 1 ? [...statuses][0] : 'mixed';

    const mins = costs.map((c) => c.min).filter((x): x is Prisma.Decimal => x !== null);
    const maxs = costs.map((c) => c.max).filter((x): x is Prisma.Decimal => x !== null);
    const min = mins.length ? mins.reduce((a, b) => a.plus(b), ZERO) : null;
    const max = maxs.length ? maxs.reduce((a, b) => a.plus(b), ZERO) : null;

    const allIndic = costs.length > 0 && costs.every((c) => c.cmvIndicativo !== null);
    const cmvIndic = allIndic ? costs.reduce((s, c) => s.plus(c.cmvIndicativo!), ZERO) : null;
    const unit = cmvIndic !== null && quantity.gt(0) ? cmvIndic.div(quantity) : null;
    const lucro = cmvIndic === null ? null : revenue.minus(cmvIndic);
    const margem = cmvIndic === null || revenue.isZero() ? null : lucro!.div(revenue).times(100);

    lines.push({
      date: groupBy === 'product' ? null : groupBy === 'day' ? dayKey(first.date) : monthKey(first.date),
      account_id: groupBy === 'product' ? null : first.accountId,
      product_ean: first.ean,
      product_description: first.description,
      quantity_sold: quantity,
      revenue,
      cost_status: status,
      unit_cost_indicativo: unit,
      cmv_indicativo: cmvIndic,
      cmv_estimado_min: min,
      cmv_estimado_max: max,
      lucro_bruto: lucro,
      margem,
    });
  }

  const receita = rows.reduce((s, r) => s.plus(r.revenue), ZERO);
  const lineMins = lines.map((l) => l.cmv_estimado_min).filter((x): x is Prisma.Decimal => x !== null);
  const lineMaxs = lines.map((l) => l.cmv_estimado_max).filter((x): x is Prisma.Decimal => x !== null);
  const totalMin = lineMins.length ? lineMins.reduce((a, b) => a.plus(b), ZERO) : null;
  const totalMax = lineMaxs.length ? lineMaxs.reduce((a, b) => a.plus(b), ZERO) : null;
  // Total indicativo só quando NENHUM item é ambíguo/indisponível (todas as linhas com indicativo).
  const allLinesIndic = lines.length > 0 && indisponiveis === 0 && lines.every((l) => l.cmv_indicativo !== null);
  const totalIndic = allLinesIndic ? lines.reduce((s, l) => s.plus(l.cmv_indicativo!), ZERO) : null;
  const lucro = totalIndic === null ? null : receita.minus(totalIndic);
  const margem = totalIndic === null || receita.isZero() ? null : lucro!.div(receita).times(100);

  const dates = rows.map((r) => r.date.getTime());
  return {
    status: 'preview',
    period: {
      start: dates.length ? new Date(Math.min(...dates)).toISOString().slice(0, 10) : null,
      end: dates.length ? new Date(Math.max(...dates)).toISOString().slice(0, 10) : null,
    },
    summary: {
      receita_total: receita,
      cmv_total_estimado_min: totalMin,
      cmv_total_estimado_max: totalMax,
      cmv_total_indicativo: totalIndic,
      lucro_bruto: lucro,
      margem_bruta: margem,
      itens_indisponiveis: indisponiveis,
      itens_estimados: estimados,
      itens_aprovados: aprovados,
    },
    lines,
  };
}
