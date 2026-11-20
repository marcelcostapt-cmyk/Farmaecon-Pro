import { Prisma } from '@prisma/client';
import { money } from './cost-money';
import {
  resolveCostCandidate,
  DEFAULT_STRATEGY,
  type CostPoolEntry,
  type MatchStrategy,
  type OrderItemForMatch,
} from './cost-matching';
import { computeMargin, isBelowRule, type CostStatus, type MarginResult } from './margin-calc';

export type GroupBy = 'sku' | 'day' | 'month';

export interface MarginItem {
  sku: string | null;
  description: string | null;
  quantity: number;
  unitPrice: Prisma.Decimal;
  saleFee: Prisma.Decimal | null;
}

export interface MarginOrderRow {
  orderId: string;
  accountId: string;
  soldAt: Date | null;
  items: MarginItem[];
}

export interface MarginGroupLine extends MarginResult {
  key: string;
  sku: string | null;
  description: string | null;
  date: string | null;
  itemsCount: number;
  costStatus: CostStatus;
}

export interface MarginPreview {
  group_by: GroupBy;
  lines: MarginGroupLine[];
  totals: { revenue: Prisma.Decimal; groupsAvailable: number; groupsUnavailable: number };
}

export interface MarginRuleRow {
  sku: string | null; // null = regra global do tenant
  minMarginPercent: Prisma.Decimal | null;
  minMarginAmount: Prisma.Decimal | null;
}

export interface MarginAlert {
  sku: string | null;
  description: string | null;
  margin: Prisma.Decimal | null;
  marginPercent: Prisma.Decimal | null;
  limitPercent: Prisma.Decimal | null;
  limitAmount: Prisma.Decimal | null;
  recommendation: string;
}

const ZERO = money('0');
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const monthKey = (d: Date) => d.toISOString().slice(0, 7);

interface Acc {
  key: string;
  sku: string | null;
  description: string | null;
  date: string | null;
  revenue: Prisma.Decimal;
  fees: Prisma.Decimal | null; // null = algum item sem taxa
  cost: Prisma.Decimal; // soma parcial (só válida se todas 'approved')
  itemStatuses: CostStatus[];
  itemsCount: number;
}

const toMatch = (item: MarginItem, soldAt: Date | null): OrderItemForMatch => ({
  ean: null,
  marketplaceSku: item.sku,
  description: item.description,
  quantity: money(item.quantity),
  soldAt,
});

/** Estado de custo de UMA linha de venda face ao acervo publicado. */
function itemCost(
  item: MarginItem,
  soldAt: Date | null,
  pool: CostPoolEntry[],
  strategy: MatchStrategy,
): { status: CostStatus; cost: Prisma.Decimal | null } {
  const r = resolveCostCandidate(toMatch(item, soldAt), pool, strategy);
  if (r.status === 'approved' && r.entry) {
    const unit = r.entry.candidates[0]?.unitCost ?? null;
    if (unit !== null) return { status: 'approved', cost: unit.times(item.quantity) };
    return { status: 'unavailable', cost: null };
  }
  if (r.status === 'estimated') return { status: 'estimated', cost: null };
  return { status: 'unavailable', cost: null };
}

function groupStatus(statuses: CostStatus[]): CostStatus {
  if (statuses.length > 0 && statuses.every((s) => s === 'approved')) return 'approved';
  if (statuses.length > 0 && statuses.every((s) => s === 'unavailable')) return 'unavailable';
  return 'mixed';
}

function bucketKey(row: MarginOrderRow, item: MarginItem, groupBy: GroupBy): { key: string; sku: string | null; date: string | null } {
  if (groupBy === 'sku') return { key: item.sku ?? '(sem sku)', sku: item.sku, date: null };
  const d = row.soldAt ?? new Date(0);
  const date = groupBy === 'day' ? dayKey(d) : monthKey(d);
  return { key: date, sku: null, date };
}

function aggregate(rows: MarginOrderRow[], pool: CostPoolEntry[], strategy: MatchStrategy, groupBy: GroupBy): Acc[] {
  const groups = new Map<string, Acc>();
  for (const row of rows) {
    for (const item of row.items) {
      const { key, sku, date } = bucketKey(row, item, groupBy);
      const g =
        groups.get(key) ??
        groups.set(key, { key, sku, description: item.description, date, revenue: ZERO, fees: ZERO, cost: ZERO, itemStatuses: [], itemsCount: 0 }).get(key)!;
      g.revenue = g.revenue.plus(item.unitPrice.times(item.quantity));
      g.fees = g.fees === null || item.saleFee === null ? null : g.fees.plus(item.saleFee);
      const ic = itemCost(item, row.soldAt, pool, strategy);
      g.itemStatuses.push(ic.status);
      if (ic.cost !== null) g.cost = g.cost.plus(ic.cost);
      g.itemsCount += 1;
    }
  }
  return [...groups.values()];
}

function toLine(g: Acc): MarginGroupLine {
  const costStatus = groupStatus(g.itemStatuses);
  const cost = costStatus === 'approved' ? g.cost : null;
  const result = computeMargin({ revenue: g.revenue, fees: g.fees, cost, costStatus });
  return { ...result, key: g.key, sku: g.sku, description: g.description, date: g.date, itemsCount: g.itemsCount, costStatus };
}

/** Prévia de margem líquida por SKU/dia/mês. Nunca fabrica número (indisponível quando falta custo ou taxa). */
export function computeMarginPreview(
  rows: MarginOrderRow[],
  pool: CostPoolEntry[],
  strategy: MatchStrategy | undefined,
  groupBy: GroupBy,
): MarginPreview {
  const lines = aggregate(rows, pool, strategy ?? DEFAULT_STRATEGY, groupBy).map(toLine);
  const revenue = lines.reduce((s, l) => s.plus(l.revenue), ZERO);
  const groupsAvailable = lines.filter((l) => l.status === 'disponivel').length;
  return {
    group_by: groupBy,
    lines,
    totals: { revenue, groupsAvailable, groupsUnavailable: lines.length - groupsAvailable },
  };
}

/** Escolhe a regra aplicável a um SKU: a específica se existir, senão a global (sku null). */
function ruleFor(sku: string | null, rules: MarginRuleRow[]): MarginRuleRow | null {
  return rules.find((r) => r.sku !== null && r.sku === sku) ?? rules.find((r) => r.sku === null) ?? null;
}

/** SKUs cuja margem (disponível) está abaixo do limite configurado. Informativo; nunca altera nada no ML. */
export function computeMarginAlerts(
  rows: MarginOrderRow[],
  pool: CostPoolEntry[],
  rules: MarginRuleRow[],
  strategy: MatchStrategy | undefined,
): MarginAlert[] {
  const { lines } = computeMarginPreview(rows, pool, strategy, 'sku');
  const alerts: MarginAlert[] = [];
  for (const line of lines) {
    const rule = ruleFor(line.sku, rules);
    if (!rule) continue;
    if (isBelowRule(line, { minMarginPercent: rule.minMarginPercent, minMarginAmount: rule.minMarginAmount })) {
      alerts.push({
        sku: line.sku,
        description: line.description,
        margin: line.margin,
        marginPercent: line.marginPercent,
        limitPercent: rule.minMarginPercent,
        limitAmount: rule.minMarginAmount,
        recommendation: 'Revisar precificação ou custo do SKU.',
      });
    }
  }
  return alerts;
}
