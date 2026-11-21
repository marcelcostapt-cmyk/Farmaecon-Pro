export type LotStatus = 'vencido' | 'vence_em_30' | 'vigente' | 'sem_validade';

export interface LotView {
  id: string;
  productName: string;
  ean: string | null;
  sku: string | null;
  lotNumber: string;
  fabricationDate: string | null;
  expiryDate: string | null;
  notes: string | null;
  updatedAt: string;
  status: LotStatus;
  daysToExpiry: number | null;
}

export const LOT_STATUS_LABEL: Record<LotStatus, string> = {
  vencido: 'Vencido',
  vence_em_30: 'Vence em 30 dias',
  vigente: 'Vigente',
  sem_validade: 'Sem validade',
};

export const STATUS_CLASS: Record<LotStatus, string> = {
  vencido: 'bg-red-100 text-red-800',
  vence_em_30: 'bg-amber-100 text-amber-900',
  vigente: 'bg-emerald-100 text-emerald-800',
  sem_validade: 'bg-muted text-muted-foreground',
};
