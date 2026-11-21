import { Prisma } from '@prisma/client';
import { findOverlap, type ExistingAdsLine } from './ads-overlap';
import type { AdsRow } from './ads-csv';

const D = (v: string) => new Prisma.Decimal(v);
const row = (line: number, day: string, sku: string | null, campaign: string | null, amount: string): AdsRow => ({ line, day, sku, campaign, amount: D(amount) });
const ex = (line: number, day: string, sku: string | null, campaign: string | null, amount: string, hash = 'hash-antigo-000000'): ExistingAdsLine => ({ line, day, sku, campaign, amount: D(amount), sourceHash: hash });

describe('sobreposição de despesas ADS (pura)', () => {
  it('ficheiro legítimo sem sobreposição: zero coincidências', () => {
    const r = findOverlap([row(2, '2026-11-12', 'A', 'C1', '10')], [ex(2, '2026-11-10', 'A', 'C1', '10')]);
    expect(r.count).toBe(0);
    expect(r.matches).toEqual([]);
  });

  it('reexportação: todas as linhas coincidem (mesmos valores, hash diferente)', () => {
    const newRows = [row(2, '2026-11-10', 'A', 'C1', '30'), row(3, '2026-11-10', null, 'C2', '20')];
    const existing = [ex(2, '2026-11-10', 'A', 'C1', '30'), ex(3, '2026-11-10', null, 'C2', '20')];
    const r = findOverlap(newRows, existing);
    expect(r.count).toBe(2);
    expect(r.amount).toBe('50.00');
    expect(r.matches[0]).toMatchObject({ newLine: 2, existingLine: 2, existingBatch: 'hash-antigo-' });
  });

  it('sobreposição parcial: só as linhas que coincidem são contadas, com o valor somado', () => {
    const newRows = [row(2, '2026-11-10', 'A', 'C1', '30'), row(3, '2026-11-11', 'B', 'C1', '99'), row(4, '2026-11-12', 'C', 'C3', '5')];
    const existing = [ex(2, '2026-11-10', 'A', 'C1', '30'), ex(3, '2026-11-11', 'B', 'C1', '20')];
    const r = findOverlap(newRows, existing);
    expect(r.count).toBe(1);
    expect(r.amount).toBe('30.00');
    expect(r.matches.map((m) => m.newLine)).toEqual([2]);
  });

  it('linhas legitimamente repetidas no ficheiro novo: cada linha existente só coincide uma vez', () => {
    const newRows = [row(2, '2026-11-10', 'A', 'C1', '10'), row(3, '2026-11-10', 'A', 'C1', '10')];
    const existing = [ex(2, '2026-11-10', 'A', 'C1', '10')];
    const r = findOverlap(newRows, existing);
    expect(r.count).toBe(1);
    expect(r.matches[0].newLine).toBe(2);
  });

  it('valores iguais com escala diferente coincidem (10 e 10.0000)', () => {
    const r = findOverlap([row(2, '2026-11-10', 'A', null, '10')], [ex(2, '2026-11-10', 'A', null, '10.0000')]);
    expect(r.count).toBe(1);
  });

  it('SKU ou campanha diferentes não coincidem; campanha com ponto e vírgula não colide com outra', () => {
    expect(findOverlap([row(2, '2026-11-10', 'A', 'C1', '10')], [ex(2, '2026-11-10', 'B', 'C1', '10')]).count).toBe(0);
    expect(findOverlap([row(2, '2026-11-10', 'A', 'x;y', '10')], [ex(2, '2026-11-10', 'A', 'x', '10')]).count).toBe(0);
  });

  it('sem linhas existentes: zero coincidências e sem erro', () => {
    expect(findOverlap([row(2, '2026-11-10', 'A', 'C1', '10')], []).count).toBe(0);
  });
});
