import { Prisma } from '@prisma/client';

export type ExpiryStatus = 'vencido' | 'a_vencer';

export interface LotRow {
  itemId: string;
  invoiceId: string;
  invoiceFilename: string;
  invoiceStatus: string;
  ean: string | null;
  description: string | null;
  lotNumber: string | null;
  quantity: Prisma.Decimal | null;
  expiryDate: Date;
}

export interface ExpiringLot {
  itemId: string;
  invoiceId: string;
  invoiceFilename: string;
  invoiceStatus: string;
  ean: string | null;
  description: string | null;
  lotNumber: string | null;
  quantity: Prisma.Decimal | null;
  expiryDate: string; // AAAA-MM-DD
  daysToExpiry: number; // negativo = já vencido
  status: ExpiryStatus;
}

export const DEFAULT_EXPIRY_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

/** Dia de calendário UTC como inteiro (ms do início do dia). */
const utcDay = (d: Date): number => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Lotes vencidos ou a vencer em até `windowDays` dias (inclusive). Puro: não lê a BD.
 * Ordenação: mais urgente primeiro (vencidos e depois os de vencimento mais próximo).
 */
export function expiringLots(rows: LotRow[], now: Date, windowDays: number): ExpiringLot[] {
  const today = utcDay(now);
  const out: ExpiringLot[] = [];
  for (const r of rows) {
    const daysToExpiry = Math.round((utcDay(r.expiryDate) - today) / DAY_MS);
    if (daysToExpiry > windowDays) continue;
    out.push({
      itemId: r.itemId,
      invoiceId: r.invoiceId,
      invoiceFilename: r.invoiceFilename,
      invoiceStatus: r.invoiceStatus,
      ean: r.ean,
      description: r.description,
      lotNumber: r.lotNumber,
      quantity: r.quantity,
      expiryDate: isoDay(r.expiryDate),
      daysToExpiry,
      status: daysToExpiry < 0 ? 'vencido' : 'a_vencer',
    });
  }
  return out.sort((a, b) => a.daysToExpiry - b.daysToExpiry);
}
