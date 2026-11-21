import { money } from './cost-money';
import type { MarginGroupLine } from './margin-preview';
import { rankMarginLines } from './margin-ranking';

// Linha de SKU já calculada (formato de computeMarginPreview). Só os campos usados pelo ranking importam.
function line(sku: string, marginPercent: string | null, margin: string | null, status: 'disponivel' | 'indisponivel' = 'disponivel'): MarginGroupLine {
  return {
    key: sku,
    sku,
    description: sku,
    date: null,
    itemsCount: 1,
    costStatus: status === 'disponivel' ? 'approved' : 'unavailable',
    status,
    reason: status === 'disponivel' ? undefined : 'indisponível',
    revenue: money('100'),
    fees: money('10'),
    cost: money('60'),
    margin: margin === null ? null : money(margin),
    marginPercent: marginPercent === null ? null : money(marginPercent),
  };
}

describe('rankMarginLines', () => {
  it('herói = maior margem %, vilão = menor margem %, sem repetir SKU', () => {
    const lines = [line('A', '42', '42'), line('B', '28', '28'), line('C', '5', '5'), line('D', '-10', '-10')];
    const r = rankMarginLines(lines, 2);
    expect(r.heroes.map((l) => l.sku)).toEqual(['A', 'B']);
    expect(r.villains.map((l) => l.sku)).toEqual(['D', 'C']); // pior primeiro
    expect(r.unavailableCount).toBe(0);
  });

  it('ignora linhas indisponíveis e conta-as (nunca entram no ranking)', () => {
    const lines = [line('A', '30', '30'), line('X', null, null, 'indisponivel'), line('Y', null, null, 'indisponivel')];
    const r = rankMarginLines(lines, 5);
    expect(r.heroes.map((l) => l.sku)).toEqual(['A']);
    expect(r.villains).toEqual([]);
    expect(r.unavailableCount).toBe(2);
  });

  it('linha com prejuízo nunca é herói, mesmo com poucas linhas', () => {
    const lines = [line('A', '30', '30'), line('Z', '-10', '-10')];
    const r = rankMarginLines(lines, 5);
    expect(r.heroes.map((l) => l.sku)).toEqual(['A']);
    expect(r.villains.map((l) => l.sku)).toEqual(['Z']);
  });

  it('desempata por margem em valor quando a percentagem é igual', () => {
    const lines = [line('P', '20', '10'), line('Q', '20', '50')];
    const r = rankMarginLines(lines, 1);
    expect(r.heroes.map((l) => l.sku)).toEqual(['Q']);
  });

  it('com uma só linha positiva, não duplica: o mesmo SKU não é herói e vilão', () => {
    const lines = [line('A', '30', '30')];
    const r = rankMarginLines(lines, 5);
    expect(r.heroes.map((l) => l.sku)).toEqual(['A']);
    expect(r.villains).toEqual([]);
  });

  it('lista vazia devolve ranking vazio', () => {
    expect(rankMarginLines([], 5)).toEqual({ heroes: [], villains: [], unavailableCount: 0 });
  });
});
