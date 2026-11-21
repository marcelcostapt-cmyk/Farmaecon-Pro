import { Prisma } from '@prisma/client';
import { money } from './cost-money';

// Regra de bonificação escolhida pelo utilizador no momento da aprovação (Decisão #2).
// GROUP_AVERAGE_NOMINAL = decisão #2 aprovada (rateio por grupo de EAN; ver group-average-cost.ts).
export type BonusRule = 'PROPORTIONAL' | 'SPECIFIC_SKU' | 'IGNORE' | 'GROUP_AVERAGE_NOMINAL';

// Linha mínima que a alocação lê (reconstruível a partir de purchase_invoice_items).
export interface BonusAllocationLine {
  lineNumber: string;
  ean: string | null;
  marketplaceSku: string | null;
  supplierCode: string | null;
  quantity: Prisma.Decimal;
  totalLine: Prisma.Decimal;
  isBonus: boolean;
  bonusQuantity: Prisma.Decimal;
}

export interface BonusDecision {
  hasBonus: boolean;
  bonusAmount: Prisma.Decimal;
  rule: BonusRule;
  specificSkuEan?: string | null;
  // Só para GROUP_AVERAGE_NOMINAL: se o IPI é recuperável (não entra na base quando true).
  ipiRecoverable?: boolean | null;
  // Sobreposição manual do custo unitário por linha (null = usar o calculado).
  manual?: Record<string, Prisma.Decimal | null>;
}

export interface AllocationLineResult {
  lineNumber: string;
  allocatedBonus: Prisma.Decimal;
  bonusQuantity: Prisma.Decimal;
  unitCostApproved: Prisma.Decimal | null; // null = indisponível (nunca custo fabricado/zero)
}

const ZERO = money('0');
const divOrNull = (num: Prisma.Decimal, den: Prisma.Decimal): Prisma.Decimal | null =>
  den.gt(0) ? num.div(den) : null;

/**
 * Aplica a regra de bonificação às linhas e devolve, por linha, a bonificação alocada e
 * o custo unitário aprovado. Regras (Decisão #2):
 * - PROPORTIONAL (§H): allocatedBonus = bonusAmount × (totalLinha ÷ totalDocumento);
 *   custo = (totalLinha + allocatedBonus) ÷ quantidade.
 * - SPECIFIC_SKU: toda a bonificação vai para a linha cujo EAN/SKU = specificSkuEan.
 * - IGNORE: bonificação não entra no custo; a unidade bonificada fica sem custo.
 * Uma sobreposição manual por linha tem prioridade. Nunca divide por zero nem fabrica custo.
 */
export function applyBonusAllocation(
  lines: BonusAllocationLine[],
  documentTotal: Prisma.Decimal,
  decision: BonusDecision,
): AllocationLineResult[] {
  const { hasBonus, bonusAmount, rule, specificSkuEan, manual } = decision;
  if (rule === 'GROUP_AVERAGE_NOMINAL') {
    throw new Error('A regra GROUP_AVERAGE_NOMINAL é calculada por groupAverageCosts, não por applyBonusAllocation.');
  }

  if (hasBonus && bonusAmount.lt(0)) {
    throw new Error('O valor da bonificação não pode ser negativo.');
  }
  // Para regras que usam o valor, ele é obrigatório quando há bonificação (IGNORE não o usa).
  if (hasBonus && rule !== 'IGNORE' && !bonusAmount.gt(0)) {
    throw new Error('O valor da bonificação é obrigatório quando há bonificação.');
  }

  let targetLine: BonusAllocationLine | undefined;
  if (hasBonus && rule === 'SPECIFIC_SKU') {
    targetLine = lines.find((l) => l.ean === specificSkuEan || l.marketplaceSku === specificSkuEan);
    if (!targetLine) {
      throw new Error(`Linha alvo da bonificação não encontrada para "${specificSkuEan ?? ''}".`);
    }
  }

  return lines.map((l) => {
    let allocatedBonus = ZERO;
    if (hasBonus) {
      if (rule === 'PROPORTIONAL') {
        allocatedBonus = documentTotal.gt(0) ? bonusAmount.times(l.totalLine).div(documentTotal) : ZERO;
      } else if (rule === 'SPECIFIC_SKU') {
        allocatedBonus = l.lineNumber === targetLine!.lineNumber ? bonusAmount : ZERO;
      }
      // IGNORE: allocatedBonus permanece 0.
    }

    let unitCostApproved: Prisma.Decimal | null;
    const manualValue = manual?.[l.lineNumber];
    if (manualValue != null) {
      unitCostApproved = manualValue;
    } else if (hasBonus && rule === 'IGNORE' && l.isBonus) {
      unitCostApproved = null; // unidade bonificada entra sem custo
    } else {
      unitCostApproved = divOrNull(l.totalLine.plus(allocatedBonus), l.quantity);
    }

    return { lineNumber: l.lineNumber, allocatedBonus, bonusQuantity: l.bonusQuantity, unitCostApproved };
  });
}
