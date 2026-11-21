import { Prisma } from '@prisma/client';

// Decisão #2 (aprovada pelo Márcio): rateio proporcional a valor nominal.
// custo médio = (valor pago + valor bonificado + vOutro + ST + IPI não recuperável) ÷ unidades totais,
// calculado por grupo de EAN (ou código do fornecedor, quando não há EAN).
// Só há bonificação quando existe linha paga do MESMO EAN/código. Nunca fabrica custo zero.

export interface GroupCostInput {
  lineNumber: string;
  ean: string | null;
  supplierCode: string | null;
  quantity: Prisma.Decimal | null;
  totalLine: Prisma.Decimal | null; // vItem (líquido)
  productsValue: Prisma.Decimal | null; // vProd (bruto)
  otherExpense: Prisma.Decimal | null; // vOutro da linha
  icmsSt: Prisma.Decimal | null;
  ipi: Prisma.Decimal | null;
  isBonus: boolean;
}

export interface GroupCostResult {
  lineNumber: string;
  unitCost: Prisma.Decimal | null; // null = indisponível (nunca zero fabricado)
  allocatedBonus: Prisma.Decimal; // parcela do valor bonificado atribuída à linha
  warnings: string[];
}

const ZERO = new Prisma.Decimal(0);
const orZero = (d: Prisma.Decimal | null): Prisma.Decimal => d ?? ZERO;

/** Valor pago da linha: vItem quando existe e é positivo; senão vProd (bonificação sem vItem). */
export function paidValueOf(line: GroupCostInput): Prisma.Decimal {
  if (line.totalLine !== null && line.totalLine.gt(0)) return line.totalLine;
  return orZero(line.productsValue);
}

/** Base do custo de uma linha: valor + vOutro + ST + IPI (só o não recuperável). */
export function costBaseOf(line: GroupCostInput, ipiRecoverable: boolean): Prisma.Decimal {
  const ipi = ipiRecoverable ? ZERO : orZero(line.ipi);
  return paidValueOf(line).plus(orZero(line.otherExpense)).plus(orZero(line.icmsSt)).plus(ipi);
}

/** Chave de agrupamento: EAN; sem EAN, código do fornecedor; sem nenhum, não há grupo. */
export function groupKeyOf(line: GroupCostInput): string | null {
  if (line.ean) return `ean:${line.ean}`;
  if (line.supplierCode) return `cProd:${line.supplierCode}`;
  return null;
}

export function groupAverageCosts(lines: GroupCostInput[], options: { ipiRecoverable: boolean }): GroupCostResult[] {
  const groups = new Map<string, GroupCostInput[]>();
  const results = new Map<string, GroupCostResult>();

  for (const line of lines) {
    const key = groupKeyOf(line);
    if (key === null) {
      results.set(line.lineNumber, {
        lineNumber: line.lineNumber,
        unitCost: null,
        allocatedBonus: ZERO,
        warnings: ['Linha sem EAN nem código do fornecedor: custo médio não calculado.'],
      });
      continue;
    }
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }

  for (const members of groups.values()) {
    const totalQty = members.reduce((s, l) => s.plus(orZero(l.quantity)), ZERO);
    const paidMembers = members.filter((l) => !l.isBonus);
    const bonusMembers = members.filter((l) => l.isBonus);
    const bonusValue = bonusMembers.reduce((s, l) => s.plus(paidValueOf(l)), ZERO);
    const hasPaidPair = paidMembers.length > 0;

    for (const line of members) {
      const warnings: string[] = [];
      if (!totalQty.gt(0)) {
        results.set(line.lineNumber, { lineNumber: line.lineNumber, unitCost: null, allocatedBonus: ZERO, warnings: ['Quantidade total do grupo zero: custo indisponível.'] });
        continue;
      }
      if (line.isBonus && !hasPaidPair) {
        results.set(line.lineNumber, {
          lineNumber: line.lineNumber,
          unitCost: null,
          allocatedBonus: ZERO,
          warnings: ['Bonificação sem linha paga do mesmo EAN/código: não rateada, custo indisponível.'],
        });
        continue;
      }
      const groupBase = members.reduce((s, l) => s.plus(costBaseOf(l, options.ipiRecoverable)), ZERO);
      const qty = orZero(line.quantity);
      results.set(line.lineNumber, {
        lineNumber: line.lineNumber,
        unitCost: groupBase.div(totalQty),
        allocatedBonus: hasPaidPair ? bonusValue.times(qty).div(totalQty) : ZERO,
        warnings,
      });
    }
  }

  return lines.map((l) => results.get(l.lineNumber)!);
}
