import { Prisma } from '@prisma/client';
import { money } from './cost-money';
import type { ParsedInvoice, ParsedInvoiceLine } from './nfe-xml-parser';

// Cada candidato é uma REGRA econômica possível para a bonificação. Qual vale é uma
// decisão de negócio (ver pendência #2) — aqui apresentamos todas, sem escolher,
// e nunca atribuímos custo zero automaticamente a item bonificado.
export interface BonusCandidate {
  rule: 'rateio_proporcional_valor_nominal' | 'bonificacao_dilui_custo' | 'bonificacao_sem_custo';
  description: string;
  formula: string;
  unitCost: Prisma.Decimal | null; // null = indisponível (evita zero fabricado)
}

export interface BonusCalculation {
  ean: string | null;
  supplierCode: string | null;
  sourceRefs: string[]; // nItem das linhas de origem
  paidQuantity: Prisma.Decimal;
  bonusQuantity: Prisma.Decimal;
  totalUnits: Prisma.Decimal;
  totalPaid: Prisma.Decimal; // soma vProd das linhas não bonificadas
  totalBonus: Prisma.Decimal; // soma vProd das linhas bonificadas
  approvedOtherExpenses: Prisma.Decimal; // despesas aprovadas; 0 na prévia
  candidates: BonusCandidate[];
  status: 'estimado / pendente de aprovação';
}

const ZERO = money('0');
const keyOf = (l: ParsedInvoiceLine): string => l.ean ?? (l.supplierProductCode ? `cProd:${l.supplierProductCode}` : 'sem-identificador');
const divOrNull = (num: Prisma.Decimal, den: Prisma.Decimal): Prisma.Decimal | null =>
  den.gt(0) ? num.div(den) : null;

/**
 * Agrupa linhas por EAN (ou código do fornecedor) e, para cada grupo com ao menos uma
 * linha de bonificação, devolve os custos médios candidatos — todos pendentes de aprovação.
 */
export function computeBonusCalculations(invoice: ParsedInvoice): BonusCalculation[] {
  const groups = new Map<string, ParsedInvoiceLine[]>();
  for (const line of invoice.lines) {
    const k = keyOf(line);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(line);
  }

  const result: BonusCalculation[] = [];
  for (const lines of groups.values()) {
    if (!lines.some((l) => l.isBonus)) continue; // só grupos com bonificação interessam aqui

    const paid = lines.filter((l) => !l.isBonus);
    const bonus = lines.filter((l) => l.isBonus);
    const paidQuantity = paid.reduce((s, l) => s.plus(l.quantity), ZERO);
    const bonusQuantity = bonus.reduce((s, l) => s.plus(l.quantity), ZERO);
    const totalUnits = paidQuantity.plus(bonusQuantity);
    const totalPaid = paid.reduce((s, l) => s.plus(l.productsValue ?? ZERO), ZERO);
    const totalBonus = bonus.reduce((s, l) => s.plus(l.productsValue ?? ZERO), ZERO);
    const approvedOtherExpenses = ZERO; // prévia: nenhuma despesa aprovada ainda

    // Rateio pelo valor nominal: inclui o valor bonificado (leitura do exemplo H da spec).
    const nominal = divOrNull(totalPaid.plus(totalBonus).plus(approvedOtherExpenses), totalUnits);
    // Bonificação dilui o custo: só o efetivamente pago, diluído em todas as unidades.
    // Nunca zero: se nada foi pago, fica indisponível.
    const dilui = totalPaid.gt(0) ? divOrNull(totalPaid.plus(approvedOtherExpenses), totalUnits) : null;
    // Bonificação sem custo: custo só nas unidades pagas; bonificadas ficam sem custo definido.
    const semCusto = paidQuantity.gt(0) ? divOrNull(totalPaid.plus(approvedOtherExpenses), paidQuantity) : null;

    result.push({
      ean: lines.find((l) => l.ean)?.ean ?? null,
      supplierCode: lines.find((l) => l.supplierProductCode)?.supplierProductCode ?? null,
      sourceRefs: lines.map((l) => l.lineNumber),
      paidQuantity,
      bonusQuantity,
      totalUnits,
      totalPaid,
      totalBonus,
      approvedOtherExpenses,
      candidates: [
        {
          rule: 'rateio_proporcional_valor_nominal',
          description: 'Custo médio pelo valor nominal da mercadoria (inclui o valor bonificado).',
          formula: `(${totalPaid} + ${totalBonus} + ${approvedOtherExpenses}) / ${totalUnits}`,
          unitCost: nominal,
        },
        {
          rule: 'bonificacao_dilui_custo',
          description: 'Custo médio diluindo a bonificação (só o valor pago ÷ total de unidades).',
          formula: `(${totalPaid} + ${approvedOtherExpenses}) / ${totalUnits}`,
          unitCost: dilui,
        },
        {
          rule: 'bonificacao_sem_custo',
          description: 'Bonificação sem custo: custo só nas unidades pagas; bonificadas indisponível.',
          formula: paidQuantity.gt(0) ? `(${totalPaid} + ${approvedOtherExpenses}) / ${paidQuantity}` : 'sem unidades pagas',
          unitCost: semCusto,
        },
      ],
      status: 'estimado / pendente de aprovação',
    });
  }
  return result;
}
