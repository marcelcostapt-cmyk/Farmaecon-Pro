import { Prisma } from '@prisma/client';
import { allocateLots, type AllocLot } from './lot-allocation';

const now = new Date('2026-11-20T15:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const q = (n: string | number) => new Prisma.Decimal(n);

const lot = (id: string, expiry: string | null, qty: string | null, created = '2026-01-01'): AllocLot => ({
  id,
  lotNumber: `L-${id}`,
  expiryDate: expiry ? d(expiry) : null,
  createdAt: new Date(`${created}T00:00:00.000Z`),
  quantity: qty === null ? null : q(qty),
});

describe('allocateLots (FEFO com fallback FIFO)', () => {
  it('consome primeiro o lote de validade mais próxima', () => {
    const r = allocateLots([lot('a', '2027-06-01', '10'), lot('b', '2027-01-01', '10')], q(12), now);
    expect(r.allocations.map((a) => [a.lotId, a.take.toString(), a.rule])).toEqual([
      ['b', '10', 'FEFO'],
      ['a', '2', 'FEFO'],
    ]);
    expect(r.missing.toString()).toBe('0');
  });

  it('sem validade: FIFO (entrada mais antiga primeiro) e depois dos lotes com validade', () => {
    const r = allocateLots(
      [lot('novo', null, '5', '2026-03-01'), lot('antigo', null, '5', '2026-01-01'), lot('com-val', '2027-01-01', '3')],
      q(9),
      now,
    );
    expect(r.allocations.map((a) => [a.lotId, a.take.toString(), a.rule])).toEqual([
      ['com-val', '3', 'FEFO'],
      ['antigo', '5', 'FIFO'],
      ['novo', '1', 'FIFO'],
    ]);
  });

  it('quantidade maior que o estoque: aloca tudo e reporta o que falta', () => {
    const r = allocateLots([lot('a', '2027-01-01', '4')], q(10), now);
    expect(r.allocated.toString()).toBe('4');
    expect(r.missing.toString()).toBe('6');
  });

  it('lotes vencidos ficam fora da alocação, com aviso', () => {
    const r = allocateLots([lot('v', '2026-11-01', '50'), lot('ok', '2027-01-01', '5')], q(5), now);
    expect(r.allocations.map((a) => a.lotId)).toEqual(['ok']);
    expect(r.warnings.some((w) => w.includes('L-v') && /vencido/.test(w))).toBe(true);
  });

  it('lote sem quantidade informada não é alocado (aviso, nunca presume estoque)', () => {
    const r = allocateLots([lot('sq', '2027-01-01', null)], q(1), now);
    expect(r.allocations).toHaveLength(0);
    expect(r.missing.toString()).toBe('1');
    expect(r.warnings.some((w) => w.includes('sem quantidade'))).toBe(true);
  });

  it('quantidade zero ou negativa não aloca nada', () => {
    expect(allocateLots([lot('a', '2027-01-01', '5')], q(0), now).allocations).toHaveLength(0);
    expect(allocateLots([lot('a', '2027-01-01', '5')], q(-2), now).missing.toString()).toBe('0');
  });
});
