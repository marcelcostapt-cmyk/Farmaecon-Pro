import { Prisma } from '@prisma/client';
import { validityOf } from './lot-validity';

// Alocação de estoque por lote: FEFO (validade mais próxima primeiro) com fallback FIFO
// (entrada mais antiga primeiro) para lotes sem validade. Função pura: não baixa estoque.

export interface AllocLot {
  id: string;
  lotNumber: string;
  expiryDate: Date | null;
  createdAt: Date;
  quantity: Prisma.Decimal | null;
}

export interface Allocation {
  lotId: string;
  lotNumber: string;
  take: Prisma.Decimal;
  rule: 'FEFO' | 'FIFO';
}

export interface AllocationResult {
  requested: Prisma.Decimal;
  allocations: Allocation[];
  allocated: Prisma.Decimal;
  missing: Prisma.Decimal; // quantidade que não tem lote disponível
  warnings: string[];
}

const ZERO = new Prisma.Decimal(0);

/** Ordem de consumo: lotes com validade (mais próxima primeiro), depois sem validade (FIFO). */
function consumptionOrder(a: AllocLot, b: AllocLot): number {
  if (a.expiryDate && b.expiryDate) {
    const d = a.expiryDate.getTime() - b.expiryDate.getTime();
    return d !== 0 ? d : a.createdAt.getTime() - b.createdAt.getTime();
  }
  if (a.expiryDate) return -1;
  if (b.expiryDate) return 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}

export function allocateLots(lots: AllocLot[], requested: Prisma.Decimal, now: Date): AllocationResult {
  const warnings: string[] = [];
  const usable: AllocLot[] = [];
  for (const lot of lots) {
    if (lot.quantity === null) {
      warnings.push(`Lote ${lot.lotNumber} sem quantidade informada: fora da alocação.`);
      continue;
    }
    if (lot.quantity.lte(0)) continue;
    if (validityOf(lot.expiryDate, now).status === 'vencido') {
      warnings.push(`Lote ${lot.lotNumber} vencido: fora da alocação.`);
      continue;
    }
    usable.push(lot);
  }

  let remaining = requested.gt(0) ? requested : ZERO;
  const allocations: Allocation[] = [];
  for (const lot of [...usable].sort(consumptionOrder)) {
    if (remaining.lte(0)) break;
    const available = lot.quantity ?? ZERO;
    const take = available.lt(remaining) ? available : remaining;
    allocations.push({ lotId: lot.id, lotNumber: lot.lotNumber, take, rule: lot.expiryDate ? 'FEFO' : 'FIFO' });
    remaining = remaining.minus(take);
  }

  const allocated = allocations.reduce((s, a) => s.plus(a.take), ZERO);
  return { requested, allocations, allocated, missing: remaining.gt(0) ? remaining : ZERO, warnings };
}
