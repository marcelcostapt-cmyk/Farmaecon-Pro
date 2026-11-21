import { validityOf } from './lot-validity';

const now = new Date('2026-11-20T15:00:00Z');
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('validityOf', () => {
  it('sem data de validade → sem_validade, dias null', () => {
    expect(validityOf(null, now)).toEqual({ status: 'sem_validade', daysToExpiry: null });
  });

  it('data anterior a hoje → vencido com dias negativos', () => {
    expect(validityOf(d('2026-11-10'), now)).toEqual({ status: 'vencido', daysToExpiry: -10 });
  });

  it('vence hoje → vence_em_30 com 0 dias (não vencido)', () => {
    expect(validityOf(d('2026-11-20'), now)).toEqual({ status: 'vence_em_30', daysToExpiry: 0 });
  });

  it('limite de 30 dias inclusivo; 31 dias já é vigente', () => {
    expect(validityOf(d('2026-12-20'), now)).toEqual({ status: 'vence_em_30', daysToExpiry: 30 });
    expect(validityOf(d('2026-12-21'), now)).toEqual({ status: 'vigente', daysToExpiry: 31 });
  });

  it('a hora do dia não altera o resultado', () => {
    const manha = new Date('2026-11-20T00:30:00Z');
    const noite = new Date('2026-11-20T23:30:00Z');
    expect(validityOf(d('2026-11-25'), manha).daysToExpiry).toBe(validityOf(d('2026-11-25'), noite).daysToExpiry);
  });
});
