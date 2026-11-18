import { money } from './cost-money';
import type { CostPoolEntry } from './cost-matching';
import { normalizeDescription } from './cost-matching';
import {
  computeMarginPreview,
  computeMarginAlerts,
  type MarginOrderRow,
  type MarginRuleRow,
} from './margin-preview';

// Entrada no acervo = um product_cost APPROVED (custo publicado).
function approvedCost(sku: string, unit: string): CostPoolEntry {
  return {
    ean: null,
    marketplaceSku: sku,
    supplierCode: null,
    description: sku,
    normalizedDescription: normalizeDescription(sku),
    costDate: new Date('2026-04-01T00:00:00Z'),
    sourceType: 'manual',
    sourceDocument: 'product_costs',
    sourceLine: `${sku}-1`,
    sourceHash: `${sku}-hash`,
    allocationRuleId: `rule-${sku}`, // != null + approved => status 'approved'
    approvalStatus: 'approved',
    isBonus: false,
    candidates: [{ ruleKey: 'publicado', unitCost: money(unit), formula: 'custo publicado' }],
  };
}

const soldAt = new Date('2026-05-10T12:00:00Z');
const row = (items: MarginOrderRow['items']): MarginOrderRow => ({
  orderId: 'o1',
  accountId: 'acc',
  soldAt,
  items,
});

describe('computeMarginPreview', () => {
  it('agrupa por SKU e calcula margem líquida quando custo APPROVED e taxa existem', () => {
    const rows = [row([{ sku: 'ABC', description: 'ABC', quantity: 2, unitPrice: money('50'), saleFee: money('10') }])];
    const pool = [approvedCost('ABC', '30')];
    const { lines } = computeMarginPreview(rows, pool, undefined, 'sku');
    const l = lines.find((x) => x.sku === 'ABC')!;
    // receita 100, taxas 10, custo 60 => margem 30 (30%)
    expect(l.status).toBe('disponivel');
    expect(l.revenue.toString()).toBe('100');
    expect(l.fees!.toString()).toBe('10');
    expect(l.cost!.toString()).toBe('60');
    expect(l.margin!.toString()).toBe('30');
    expect(l.marginPercent!.toString()).toBe('30');
  });

  it('indisponível quando um item do grupo não tem taxa (saleFee null)', () => {
    const rows = [row([{ sku: 'ABC', description: 'ABC', quantity: 1, unitPrice: money('50'), saleFee: null }])];
    const { lines } = computeMarginPreview(rows, [approvedCost('ABC', '30')], undefined, 'sku');
    expect(lines[0].status).toBe('indisponivel');
    expect(lines[0].reason).toMatch(/taxa/i);
  });

  it('indisponível quando não há custo publicado para o SKU', () => {
    const rows = [row([{ sku: 'SEMCUSTO', description: 'x', quantity: 1, unitPrice: money('50'), saleFee: money('5') }])];
    const { lines } = computeMarginPreview(rows, [approvedCost('OUTRO', '30')], undefined, 'sku');
    expect(lines[0].status).toBe('indisponivel');
    expect(lines[0].cost).toBeNull();
  });

  it('agrupa por mês somando itens', () => {
    const rows = [
      row([{ sku: 'ABC', description: 'ABC', quantity: 1, unitPrice: money('50'), saleFee: money('5') }]),
      row([{ sku: 'ABC', description: 'ABC', quantity: 1, unitPrice: money('50'), saleFee: money('5') }]),
    ];
    const { lines } = computeMarginPreview(rows, [approvedCost('ABC', '30')], undefined, 'month');
    expect(lines).toHaveLength(1);
    expect(lines[0].revenue.toString()).toBe('100');
    expect(lines[0].cost!.toString()).toBe('60');
  });
});

describe('computeMarginAlerts', () => {
  const rows = [row([{ sku: 'ABC', description: 'Produto ABC', quantity: 2, unitPrice: money('50'), saleFee: money('10') }])];
  const pool = [approvedCost('ABC', '30')]; // margem 30%

  it('alerta quando a margem fica abaixo da regra do SKU', () => {
    const rules: MarginRuleRow[] = [{ sku: 'ABC', minMarginPercent: money('40'), minMarginAmount: null }];
    const alerts = computeMarginAlerts(rows, pool, rules, undefined);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].sku).toBe('ABC');
    expect(alerts[0].marginPercent!.toString()).toBe('30');
  });

  it('a regra específica do SKU sobrepõe-se à global', () => {
    const rules: MarginRuleRow[] = [
      { sku: null, minMarginPercent: money('50'), minMarginAmount: null }, // global exigente
      { sku: 'ABC', minMarginPercent: money('20'), minMarginAmount: null }, // específica permissiva
    ];
    // 30% >= 20% (regra do SKU) => não alerta, mesmo abaixo da global
    expect(computeMarginAlerts(rows, pool, rules, undefined)).toHaveLength(0);
  });

  it('não alerta quando a margem está indisponível', () => {
    const noCost = [approvedCost('OUTRO', '30')];
    const rules: MarginRuleRow[] = [{ sku: null, minMarginPercent: money('90'), minMarginAmount: null }];
    expect(computeMarginAlerts(rows, noCost, rules, undefined)).toHaveLength(0);
  });
});
