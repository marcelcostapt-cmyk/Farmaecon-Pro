export type ValidityStatus = 'vencido' | 'vence_em_30' | 'vigente' | 'sem_validade';

export const VALIDITY_STATUSES: readonly ValidityStatus[] = ['vencido', 'vence_em_30', 'vigente', 'sem_validade'];
export const SOON_WINDOW_DAYS = 30;

export interface Validity {
  status: ValidityStatus;
  daysToExpiry: number | null; // negativo = já vencido; null = sem validade
}

const DAY_MS = 86_400_000;
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Estado de validade de um lote, por dias de calendário UTC a partir de `now`.
 * vencido: já passou · vence_em_30: vence hoje ou em até 30 dias · vigente: depois · sem_validade: sem data.
 */
export function validityOf(expiryDate: Date | null, now: Date): Validity {
  if (expiryDate === null) return { status: 'sem_validade', daysToExpiry: null };
  const days = Math.round((utcDay(expiryDate) - utcDay(now)) / DAY_MS);
  if (days < 0) return { status: 'vencido', daysToExpiry: days };
  if (days <= SOON_WINDOW_DAYS) return { status: 'vence_em_30', daysToExpiry: days };
  return { status: 'vigente', daysToExpiry: days };
}
