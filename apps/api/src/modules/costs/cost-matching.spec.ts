import { Prisma } from '@prisma/client';
import {
  normalizeDescription,
  resolveCostCandidate,
  DEFAULT_STRATEGY,
  type CostPoolEntry,
} from './cost-matching';

const D = (v: string) => new Prisma.Decimal(v);
const entry = (over: Partial<CostPoolEntry>): CostPoolEntry => ({
  ean: null,
  marketplaceSku: null,
  supplierCode: null,
  description: null,
  normalizedDescription: '',
  costDate: new Date('2026-08-01'),
  sourceType: 'xml',
  sourceDocument: 'NF-e teste',
  sourceLine: '1',
  sourceHash: 'sha256:abc',
  allocationRuleId: null,
  approvalStatus: 'pending_review',
  isBonus: false,
  candidates: [{ ruleKey: 'custo_direto', unitCost: D('10.00'), formula: 'vItem/qCom' }],
  ...over,
});

describe('normalizeDescription', () => {
  it('remove acentos, pontuação e colapsa espaços', () => {
    expect(normalizeDescription('  Paracetamol 750mg (Caixa)  ')).toBe('paracetamol 750mg caixa');
    expect(normalizeDescription('ÁGUA  Oxigenada')).toBe('agua oxigenada');
    expect(normalizeDescription(null)).toBe('');
  });
});

describe('resolveCostCandidate — matching sugestivo (preview)', () => {
  const item = { ean: '7897947607996', marketplaceSku: 'SKU1', description: 'Produto B', quantity: D('1'), soldAt: new Date('2026-11-20') };

  it('casa por EAN e devolve a origem do custo', () => {
    const pool = [entry({ ean: '7897947607996', normalizedDescription: 'produto b' })];
    const r = resolveCostCandidate(item, pool, DEFAULT_STRATEGY);
    expect(r.status).toBe('estimated');
    expect(r.matchedBy).toBe('ean');
    expect(r.entry!.sourceHash).toBe('sha256:abc');
    expect(r.entry!.sourceLine).toBe('1');
  });

  it('sem candidato → indisponível', () => {
    const r = resolveCostCandidate(item, [entry({ ean: '0000000000000' })], DEFAULT_STRATEGY);
    expect(r.status).toBe('unavailable');
    expect(r.entry).toBeNull();
  });

  it('respeita a ordem da estratégia: EAN antes de SKU', () => {
    const pool = [
      entry({ marketplaceSku: 'SKU1', sourceLine: 'porSKU' }),
      entry({ ean: '7897947607996', sourceLine: 'porEAN' }),
    ];
    expect(resolveCostCandidate(item, pool, DEFAULT_STRATEGY).entry!.sourceLine).toBe('porEAN');
  });

  it('entre vários custos do mesmo produto usa o mais recente antes da venda', () => {
    const pool = [
      entry({ ean: '7897947607996', costDate: new Date('2026-08-10'), sourceLine: 'ago' }),
      entry({ ean: '7897947607996', costDate: new Date('2026-10-05'), sourceLine: 'out' }),
      entry({ ean: '7897947607996', costDate: new Date('2026-12-01'), sourceLine: 'dez-pos-venda' }),
    ];
    const r = resolveCostCandidate(item, pool, DEFAULT_STRATEGY);
    expect(r.entry!.sourceLine).toBe('out'); // mais recente <= 2026-11-20
  });

  it('se todos os custos são posteriores à venda, usa o mais antigo com aviso', () => {
    const pool = [
      entry({ ean: '7897947607996', costDate: new Date('2026-12-01'), sourceLine: 'dez' }),
      entry({ ean: '7897947607996', costDate: new Date('2027-01-01'), sourceLine: 'jan' }),
    ];
    const r = resolveCostCandidate(item, pool, DEFAULT_STRATEGY);
    expect(r.entry!.sourceLine).toBe('dez');
    expect(r.warnings.some((w) => /posterior à venda/i.test(w))).toBe(true);
  });

  it('item com bonificação sem regra aprovada → estimado com aviso de bonificação', () => {
    const pool = [entry({ ean: '7897947607996', isBonus: true, candidates: [
      { ruleKey: 'rateio_proporcional_valor_nominal', unitCost: D('12.21182'), formula: 'f1' },
      { ruleKey: 'bonificacao_dilui_custo', unitCost: D('0.01974'), formula: 'f2' },
      { ruleKey: 'bonificacao_sem_custo', unitCost: D('13.46'), formula: 'f3' },
    ] })];
    const r = resolveCostCandidate(item, pool, DEFAULT_STRATEGY);
    expect(r.status).toBe('estimated');
    expect(r.entry!.candidates).toHaveLength(3);
    expect(r.warnings.some((w) => /bonificação/i.test(w))).toBe(true);
  });
});
