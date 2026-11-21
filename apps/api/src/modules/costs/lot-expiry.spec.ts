import { Prisma } from '@prisma/client';
import { expiringLots, type LotRow } from './lot-expiry';

const now = new Date('2026-11-20T15:00:00Z'); // hora do dia no meio do dia: não deve mudar o resultado

const lot = (id: string, expiry: string, lotNumber = `L-${id}`): LotRow => ({
  itemId: id,
  invoiceId: 'inv-1',
  invoiceFilename: 'nfe.xml',
  invoiceStatus: 'APPROVED',
  ean: null,
  description: `PRODUTO ${id}`,
  lotNumber,
  quantity: new Prisma.Decimal(10),
  expiryDate: new Date(`${expiry}T00:00:00.000Z`),
});

describe('expiringLots', () => {
  it('inclui vencidos e os que vencem dentro da janela; exclui os que vencem depois', () => {
    const rows = [lot('a', '2026-11-10'), lot('b', '2026-12-31'), lot('c', '2027-06-01')];
    const out = expiringLots(rows, now, 90);
    expect(out.map((l) => l.itemId)).toEqual(['a', 'b']);
    expect(out[0].status).toBe('vencido');
    expect(out[0].daysToExpiry).toBe(-10);
    expect(out[1].status).toBe('a_vencer');
    expect(out[1].daysToExpiry).toBe(41);
  });

  it('inclui vencimento exatamente no limite da janela', () => {
    // 2026-11-20 + 30 dias = 2026-12-20
    expect(expiringLots([lot('x', '2026-12-20')], now, 30)).toHaveLength(1);
    expect(expiringLots([lot('y', '2026-12-21')], now, 30)).toHaveLength(0);
  });

  it('vencimento de hoje conta como a vencer (0 dias), não como vencido', () => {
    const [l] = expiringLots([lot('h', '2026-11-20')], now, 0);
    expect(l.daysToExpiry).toBe(0);
    expect(l.status).toBe('a_vencer');
  });

  it('ordena do mais urgente: vencidos primeiro, depois o mais próximo', () => {
    const rows = [lot('p', '2026-12-15'), lot('q', '2026-11-01'), lot('r', '2026-11-25')];
    expect(expiringLots(rows, now, 90).map((l) => l.itemId)).toEqual(['q', 'r', 'p']);
  });

  it('lista vazia devolve vazio', () => {
    expect(expiringLots([], now, 90)).toEqual([]);
  });
});
