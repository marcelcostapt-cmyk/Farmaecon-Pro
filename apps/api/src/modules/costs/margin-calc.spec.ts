import { money } from './cost-money';
import { computeMargin, isBelowRule, type MarginComponents, type MarginRule } from './margin-calc';

const base = (over: Partial<MarginComponents> = {}): MarginComponents => ({
  revenue: money('100'),
  fees: money('10'),
  cost: money('60'),
  costStatus: 'approved',
  ...over,
});

describe('computeMargin', () => {
  it('margem líquida = receita − taxas − custo, e percentagem sobre a receita', () => {
    const r = computeMargin(base());
    expect(r.status).toBe('disponivel');
    expect(r.margin!.toString()).toBe('30'); // 100 − 10 − 60
    expect(r.marginPercent!.toString()).toBe('30'); // 30/100*100
  });

  it('indisponível quando falta o custo (null) — nunca fabrica custo', () => {
    const r = computeMargin(base({ cost: null, costStatus: 'unavailable' }));
    expect(r.status).toBe('indisponivel');
    expect(r.margin).toBeNull();
    expect(r.marginPercent).toBeNull();
    expect(r.reason).toMatch(/custo/i);
  });

  it('indisponível quando o custo é apenas estimado (não APPROVED)', () => {
    const r = computeMargin(base({ costStatus: 'estimated' }));
    expect(r.status).toBe('indisponivel');
    expect(r.reason).toMatch(/aprovad/i);
  });

  it('indisponível quando o custo é misto (mixed)', () => {
    const r = computeMargin(base({ costStatus: 'mixed' }));
    expect(r.status).toBe('indisponivel');
  });

  it('indisponível quando faltam as taxas ML (null)', () => {
    const r = computeMargin(base({ fees: null }));
    expect(r.status).toBe('indisponivel');
    expect(r.reason).toMatch(/taxa/i);
  });

  it('percentagem null quando receita é zero (nunca divide por zero)', () => {
    const r = computeMargin(base({ revenue: money('0'), fees: money('0'), cost: money('0') }));
    expect(r.margin!.toString()).toBe('0');
    expect(r.marginPercent).toBeNull();
  });

  it('margem pode ser negativa (prejuízo) e continua disponível', () => {
    const r = computeMargin(base({ revenue: money('100'), fees: money('30'), cost: money('90') }));
    expect(r.status).toBe('disponivel');
    expect(r.margin!.toString()).toBe('-20');
  });
});

describe('isBelowRule', () => {
  const disponivel = computeMargin(base()); // margem 30, 30%

  it('false quando a margem está indisponível (não alerta sem dados)', () => {
    const indisp = computeMargin(base({ cost: null, costStatus: 'unavailable' }));
    expect(isBelowRule(indisp, { minMarginPercent: money('50'), minMarginAmount: null })).toBe(false);
  });

  it('abaixo do limite percentual', () => {
    expect(isBelowRule(disponivel, { minMarginPercent: money('35'), minMarginAmount: null })).toBe(true);
    expect(isBelowRule(disponivel, { minMarginPercent: money('25'), minMarginAmount: null })).toBe(false);
  });

  it('abaixo do limite de valor', () => {
    expect(isBelowRule(disponivel, { minMarginPercent: null, minMarginAmount: money('40') })).toBe(true);
    expect(isBelowRule(disponivel, { minMarginPercent: null, minMarginAmount: money('20') })).toBe(false);
  });

  it('regra vazia (sem limites) nunca alerta', () => {
    const rule: MarginRule = { minMarginPercent: null, minMarginAmount: null };
    expect(isBelowRule(disponivel, rule)).toBe(false);
  });
});
