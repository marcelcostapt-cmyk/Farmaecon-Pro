import { Prisma } from '@prisma/client';
import type { MarginAlert, MarginGroupLine, MarginPreview } from '../costs/margin-preview';
import type { FeeChange } from '../costs/fee-change';
import { analyseFinancialMargin, blockReasonFor, BLOCK_REASONS, type AnalysisInput } from './central-farma-analysis';

const D = (v: string | number) => new Prisma.Decimal(v);

function line(partial: Partial<MarginGroupLine> & { sku: string }): MarginGroupLine {
  return {
    key: partial.sku,
    sku: partial.sku,
    description: `Produto ${partial.sku}`,
    date: null,
    itemsCount: 1,
    costStatus: 'approved',
    status: 'disponivel',
    revenue: D(100),
    fees: D(10),
    cost: D(50),
    margin: D(40),
    marginPercent: D(40),
    ...partial,
  };
}

function preview(lines: MarginGroupLine[]): MarginPreview {
  return {
    group_by: 'sku',
    lines,
    totals: {
      revenue: lines.reduce((s, l) => s.plus(l.revenue), D(0)),
      groupsAvailable: lines.filter((l) => l.status === 'disponivel').length,
      groupsUnavailable: lines.filter((l) => l.status !== 'disponivel').length,
    },
  };
}

function input(overrides: Partial<AnalysisInput> = {}): AnalysisInput {
  return {
    account: { id: 'acc-1', name: 'Conta 1', status: 'ACTIVE' },
    counts: { orders: 3, approvedCosts: 2, marginRules: 1 },
    preview: preview([line({ sku: 'A' })]),
    alerts: [],
    feeChanges: [],
    ...overrides,
  };
}

describe('Central Farma — bloqueios por dependência', () => {
  it('conta desligada não é analisada', () => {
    const r = analyseFinancialMargin(input({ account: { id: 'acc-1', name: 'Conta 1', status: 'DISCONNECTED' } }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(BLOCK_REASONS.ACCOUNT_DISCONNECTED);
    expect(r.findings).toEqual([]);
    expect(r.summary.skusAnalysed).toBe(0);
  });

  it('sem pedidos sincronizados não há dados: bloqueado, sem números', () => {
    const r = analyseFinancialMargin(input({ counts: { orders: 0, approvedCosts: 2, marginRules: 1 } }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(BLOCK_REASONS.NO_ORDERS);
  });

  it('sem custos aprovados a margem não é calculável: bloqueado por dependência', () => {
    const r = analyseFinancialMargin(input({ counts: { orders: 3, approvedCosts: 0, marginRules: 1 } }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(BLOCK_REASONS.NO_APPROVED_COSTS);
  });

  it('blockReasonFor devolve null quando as dependências existem', () => {
    expect(blockReasonFor(input())).toBeNull();
  });

  it('a origem dos dados é sempre declarada, mesmo quando bloqueado', () => {
    const r = analyseFinancialMargin(input({ counts: { orders: 0, approvedCosts: 0, marginRules: 0 } }));
    expect(r.sources.map((s) => s.name)).toEqual(['orders', 'product_costs', 'margin_rules', 'margin.preview', 'margin.fee-changes']);
    expect(r.sources[0].count).toBe(0);
  });
});

describe('Central Farma — análise concluída', () => {
  it('SKU abaixo do limite gera risco com evidência e recomendação ligada ao achado', () => {
    const alert: MarginAlert = {
      sku: 'B', description: 'Produto B', margin: D(28), marginPercent: D(28), limitPercent: D(40), limitAmount: null,
      recommendation: 'Revisar precificação ou custo do SKU.',
    };
    const r = analyseFinancialMargin(input({ alerts: [alert] }));
    const risk = r.findings.find((f) => f.severity === 'risco');
    expect(risk?.evidence).toMatchObject({ sku: 'B', margemPercent: '28.0', limitePercent: '40.0' });
    expect(r.recommendations).toEqual([
      expect.objectContaining({ basedOn: [risk?.id] }),
    ]);
    expect(r.summary.alertsBelowLimit).toBe(1);
  });

  it('subida de taxa ML é risco; descida é informativa', () => {
    const up: FeeChange = { sku: 'A', description: null, fromMonth: '2026-04', toMonth: '2026-05', fromRatePercent: D(10), toRatePercent: D(13), deltaPp: D(3) };
    const down: FeeChange = { sku: 'C', description: null, fromMonth: '2026-04', toMonth: '2026-05', fromRatePercent: D(13), toRatePercent: D(10), deltaPp: D(-3) };
    const r = analyseFinancialMargin(input({ feeChanges: [up, down] }));
    const severities = r.findings.filter((f) => f.id.startsWith('taxa')).map((f) => f.severity);
    expect(severities).toEqual(['risco', 'info']);
    expect(r.summary.feeIncreases).toBe(1);
    expect(r.summary.feeDecreases).toBe(1);
    expect(r.recommendations.map((x) => x.text).join(' ')).toContain('SKU A');
    expect(r.recommendations.map((x) => x.text).join(' ')).not.toContain('SKU C');
  });

  it('sem limites configurados declara pendência e não inventa alertas', () => {
    const r = analyseFinancialMargin(input({ counts: { orders: 3, approvedCosts: 2, marginRules: 0 } }));
    expect(r.findings.find((f) => f.id === 'sem-limites')?.severity).toBe('pendencia');
    expect(r.summary.alertsBelowLimit).toBe(0);
  });

  it('SKUs indisponíveis são contados por motivo, sem valor estimado', () => {
    const lines = [
      line({ sku: 'OK' }),
      line({ sku: 'SEM-TAXA', status: 'indisponivel', fees: null, cost: D(50), margin: null, marginPercent: null }),
      line({ sku: 'SEM-CUSTO', status: 'indisponivel', costStatus: 'unavailable', cost: null, margin: null, marginPercent: null }),
      line({ sku: 'NAO-APROVADO', status: 'indisponivel', costStatus: 'estimated', cost: null, margin: null, marginPercent: null }),
    ];
    const r = analyseFinancialMargin(input({ preview: preview(lines) }));
    expect(r.summary).toMatchObject({
      skusAnalysed: 4,
      skusAvailable: 1,
      skusUnavailable: 3,
      unavailableBy: { semTaxa: 1, semCustoPublicado: 1, custoNaoAprovado: 1 },
    });
    expect(r.findings.find((f) => f.id === 'cobertura')?.severity).toBe('pendencia');
    expect(JSON.stringify(r)).not.toMatch(/NaN|Infinity/);
  });

  it('receita vem da soma real do preview, com duas casas decimais', () => {
    const r = analyseFinancialMargin(input({ preview: preview([line({ sku: 'A', revenue: D('100.5') }), line({ sku: 'B', revenue: D(20) })]) }));
    expect(r.summary.revenue).toBe('120.50');
  });

  it('todas as saídas trazem as premissas de leitura (não é DRE)', () => {
    const r = analyseFinancialMargin(input());
    expect(r.caveats.join(' ')).toMatch(/Não é DRE/);
    expect(r.caveats.join(' ')).toMatch(/não altera/);
  });

  it('limita achados listados a 20 e mantém o total real', () => {
    const alerts: MarginAlert[] = Array.from({ length: 25 }, (_, i) => ({
      sku: `S${i}`, description: null, margin: D(1), marginPercent: D(1), limitPercent: D(40), limitAmount: null, recommendation: '',
    }));
    const r = analyseFinancialMargin(input({ alerts }));
    expect(r.findings.filter((f) => f.id.startsWith('alerta'))).toHaveLength(20);
    expect(r.summary.alertsBelowLimit).toBe(25);
  });
});
