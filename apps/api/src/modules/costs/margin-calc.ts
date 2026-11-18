import { Prisma } from '@prisma/client';

// Estado do custo vindo do acervo de compras (ver cmv-preview/dre-preview).
export type CostStatus = 'approved' | 'estimated' | 'unavailable' | 'mixed';

/**
 * Componentes da margem de um grupo (SKU/dia/mês). Regra de ouro: nunca fabricar número.
 * - `fees` = soma das taxas ML (saleFee); null quando não disponível.
 * - `cost` = CMV indicativo; só conta quando `costStatus === 'approved'`.
 */
export interface MarginComponents {
  revenue: Prisma.Decimal;
  fees: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  costStatus: CostStatus;
}

export interface MarginResult {
  status: 'disponivel' | 'indisponivel';
  reason?: string;
  revenue: Prisma.Decimal;
  fees: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  margin: Prisma.Decimal | null; // receita − taxas − custo
  marginPercent: Prisma.Decimal | null; // margin / receita * 100
}

export interface MarginRule {
  minMarginPercent: Prisma.Decimal | null;
  minMarginAmount: Prisma.Decimal | null;
}

/**
 * Margem líquida = receita − taxas ML − CMV. Só é calculada quando TODOS os componentes
 * existem e o custo está APROVADO; caso contrário devolve `indisponivel` (nunca estima nem
 * fabrica). A percentagem é null quando a receita é zero (nunca divide por zero).
 */
export function computeMargin(c: MarginComponents): MarginResult {
  const unavailable = (reason: string): MarginResult => ({
    status: 'indisponivel',
    reason,
    revenue: c.revenue,
    fees: c.fees,
    cost: c.cost,
    margin: null,
    marginPercent: null,
  });

  if (c.fees === null) return unavailable('Taxas ML não disponíveis para o período.');
  if (c.cost === null) return unavailable('Sem custo publicado para o SKU.');
  if (c.costStatus !== 'approved') {
    return unavailable('Custo não está aprovado (estimado/misto) — margem não confirmável.');
  }

  const margin = c.revenue.minus(c.fees).minus(c.cost);
  const marginPercent = c.revenue.isZero() ? null : margin.div(c.revenue).times(100);
  return {
    status: 'disponivel',
    revenue: c.revenue,
    fees: c.fees,
    cost: c.cost,
    margin,
    marginPercent,
  };
}

/** Verdadeiro quando a margem (disponível) está abaixo de algum limite configurado. */
export function isBelowRule(result: MarginResult, rule: MarginRule): boolean {
  if (result.status !== 'disponivel') return false;
  const belowPercent =
    rule.minMarginPercent !== null && result.marginPercent !== null && result.marginPercent.lt(rule.minMarginPercent);
  const belowAmount = rule.minMarginAmount !== null && result.margin !== null && result.margin.lt(rule.minMarginAmount);
  return Boolean(belowPercent || belowAmount);
}
