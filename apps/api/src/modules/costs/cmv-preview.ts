import { Prisma } from '@prisma/client';
import { money } from './cost-money';
import type { UnifiedInvoice } from './document-parser';
import {
  normalizeDescription,
  resolveCostCandidate,
  type CostPoolEntry,
  type MatchStrategy,
  type OrderItemForMatch,
} from './cost-matching';

const ZERO = money('0');
const docLabel = (doc: UnifiedInvoice): string =>
  doc.source === 'xml' && doc.invoiceNumber ? `NF-e ${doc.invoiceNumber}` : doc.originalFilename;

/** Converte um documento (prévia) em entradas do acervo de custos — sempre pending_review. */
export function buildCostPoolFromInvoice(doc: UnifiedInvoice): CostPoolEntry[] {
  const entries: CostPoolEntry[] = [];
  const covered = new Set<string>();
  const hash = `sha256:${doc.fileHashSha256}`;
  const expenseWarn =
    doc.otherExpenses && !doc.otherExpenses.isZero()
      ? [`Documento tem outras despesas (R$ ${doc.otherExpenses}); inclusão no custo depende de regra aprovada`]
      : [];

  for (const bc of doc.bonusCalculations) {
    for (const k of [bc.ean, bc.supplierCode]) if (k) covered.add(k);
    entries.push({
      ean: bc.ean,
      marketplaceSku: null,
      supplierCode: bc.supplierCode,
      description: null,
      normalizedDescription: '',
      costDate: doc.issuedAt,
      sourceType: doc.source,
      sourceDocument: docLabel(doc),
      sourceLine: bc.sourceRefs.join(','),
      sourceHash: hash,
      allocationRuleId: null,
      approvalStatus: 'pending_review',
      isBonus: true,
      warnings: expenseWarn,
      candidates: bc.candidates.map((c) => ({
        ruleKey: c.rule,
        unitCost: c.unitCost,
        formula: c.formula,
        ...(c.rule === 'bonificacao_sem_custo'
          ? { bonusUnits: bc.bonusQuantity, bonusStatus: c.unitCost === null ? 'indisponível_sem_regra' : undefined }
          : {}),
      })),
    });
  }

  for (const l of doc.lines) {
    if (l.isBonus) continue; // já consolidado em bonusCalculations
    const key = l.ean ?? l.supplierProductCode;
    if (key && covered.has(key)) continue;
    const unitCost = l.unitCostPaid ?? l.unitCostExtracted;
    entries.push({
      ean: l.ean,
      marketplaceSku: l.marketplaceSku,
      supplierCode: l.supplierProductCode,
      description: l.description,
      normalizedDescription: normalizeDescription(l.description),
      costDate: doc.issuedAt,
      sourceType: doc.source,
      sourceDocument: docLabel(doc),
      sourceLine: l.lineNumber,
      sourceHash: hash,
      allocationRuleId: null,
      approvalStatus: 'pending_review',
      isBonus: false,
      warnings: expenseWarn,
      candidates: [{ ruleKey: 'custo_direto', unitCost, formula: 'valor pago / quantidade' }],
    });
  }
  return entries;
}

export interface PreviewOrderItem {
  lineId: string;
  ean: string | null;
  marketplaceSku: string | null;
  description: string | null;
  quantity: Prisma.Decimal;
  revenue: Prisma.Decimal;
  soldAt: Date | null;
}

export interface CmvCandidateView {
  rule_key: string;
  unit_cost: Prisma.Decimal | null;
  total_cost: Prisma.Decimal | null;
  formula: string;
  source_type: string;
  source_document: string;
  source_line: string;
  source_hash: string;
  allocation_rule_id: string | null;
  approval_status: string;
  bonus_units?: Prisma.Decimal;
  bonus_status?: string;
}

export interface CmvPreviewItem {
  line_id: string;
  ean: string | null;
  description: string | null;
  quantity_sold: Prisma.Decimal;
  revenue: Prisma.Decimal;
  cost_status: 'approved' | 'estimated' | 'unavailable';
  cost_status_reason: string;
  cost_candidates: CmvCandidateView[];
  cmv_indicativo: Prisma.Decimal | null;
  observacao: string | null;
  warnings: string[];
}

export interface CmvPreviewTotals {
  revenue: Prisma.Decimal;
  cmv_estimado_min: Prisma.Decimal | null;
  cmv_estimado_max: Prisma.Decimal | null;
  cmv_indicativo: Prisma.Decimal | null;
  lucro_bruto: Prisma.Decimal | null;
  margem: Prisma.Decimal | null;
  itens_indisponiveis: number;
  itens_estimados: number;
  itens_aprovados: number;
}

export interface CmvPreview {
  order_id: string;
  status: 'preview';
  items: CmvPreviewItem[];
  totals: CmvPreviewTotals;
}

function previewItem(item: PreviewOrderItem, pool: CostPoolEntry[], strategy: MatchStrategy): CmvPreviewItem {
  const r = resolveCostCandidate(
    { ean: item.ean, marketplaceSku: item.marketplaceSku, description: item.description, quantity: item.quantity, soldAt: item.soldAt } as OrderItemForMatch,
    pool,
    strategy,
  );
  if (r.entry === null) {
    return {
      line_id: item.lineId, ean: item.ean, description: item.description,
      quantity_sold: item.quantity, revenue: item.revenue,
      cost_status: 'unavailable', cost_status_reason: 'Sem custo correspondente no acervo de compras',
      cost_candidates: [], cmv_indicativo: null, observacao: 'Custo não encontrado', warnings: r.warnings,
    };
  }
  const e = r.entry;
  const candidates: CmvCandidateView[] = e.candidates.map((c) => ({
    rule_key: c.ruleKey,
    unit_cost: c.unitCost,
    total_cost: c.unitCost === null ? null : c.unitCost.times(item.quantity),
    formula: c.formula,
    source_type: e.sourceType,
    source_document: e.sourceDocument,
    source_line: e.sourceLine,
    source_hash: e.sourceHash,
    allocation_rule_id: e.allocationRuleId,
    approval_status: e.approvalStatus,
    ...(c.bonusUnits !== undefined ? { bonus_units: c.bonusUnits } : {}),
    ...(c.bonusStatus !== undefined ? { bonus_status: c.bonusStatus } : {}),
  }));
  // Indicativo só quando há exatamente 1 candidato com custo definido (sem ambiguidade de regra).
  const single = candidates.length === 1 && candidates[0].unit_cost !== null;
  const cmv_indicativo = single ? candidates[0].unit_cost!.times(item.quantity) : null;
  const reason =
    candidates.length > 1
      ? `Regra de bonificação pendente (decisão de negócio #2); ${candidates.length} candidatos`
      : single
        ? `Custo estimado ${candidates[0].unit_cost!.toString()}/un (regra pendente de aprovação)`
        : 'Custo indisponível para esta linha';
  return {
    line_id: item.lineId, ean: item.ean, description: item.description,
    quantity_sold: item.quantity, revenue: item.revenue,
    cost_status: r.status, cost_status_reason: reason,
    cost_candidates: candidates, cmv_indicativo,
    observacao: candidates.length > 1 ? 'Aguardando decisão de negócio #2' : null,
    warnings: r.warnings,
  };
}

const definedCosts = (it: CmvPreviewItem): Prisma.Decimal[] =>
  it.cost_candidates.map((c) => c.total_cost).filter((x): x is Prisma.Decimal => x !== null);

/** Monta a prévia de CMV de um pedido. Nada é persistido; totais ambíguos ficam null. */
export function computeOrderCmvPreview(
  orderId: string,
  items: PreviewOrderItem[],
  pool: CostPoolEntry[],
  strategy: MatchStrategy,
): CmvPreview {
  const views = items.map((i) => previewItem(i, pool, strategy));
  const revenue = views.reduce((s, v) => s.plus(v.revenue), ZERO);

  const estimated = views.filter((v) => v.cost_status === 'estimated');
  const unavailable = views.filter((v) => v.cost_status === 'unavailable');
  const approved = views.filter((v) => v.cost_status === 'approved');

  // Range só sobre itens com algum custo definido; indisponíveis contam à parte.
  const priced = views.filter((v) => definedCosts(v).length > 0);
  const min = priced.length
    ? priced.reduce((s, v) => s.plus(definedCosts(v).reduce((a, b) => (b.lt(a) ? b : a))), ZERO)
    : null;
  const max = priced.length
    ? priced.reduce((s, v) => s.plus(definedCosts(v).reduce((a, b) => (b.gt(a) ? b : a))), ZERO)
    : null;

  // Indicativo total só se TODOS os itens têm indicativo único (nenhum ambíguo/indisponível).
  const allSingle = views.length > 0 && views.every((v) => v.cmv_indicativo !== null);
  const cmvIndicativo = allSingle ? views.reduce((s, v) => s.plus(v.cmv_indicativo!), ZERO) : null;
  const lucro = cmvIndicativo === null ? null : revenue.minus(cmvIndicativo);
  const margem = cmvIndicativo === null || revenue.isZero() ? null : lucro!.div(revenue).times(100);

  return {
    order_id: orderId,
    status: 'preview',
    items: views,
    totals: {
      revenue,
      cmv_estimado_min: min,
      cmv_estimado_max: max,
      cmv_indicativo: cmvIndicativo,
      lucro_bruto: lucro,
      margem,
      itens_indisponiveis: unavailable.length,
      itens_estimados: estimated.length,
      itens_aprovados: approved.length,
    },
  };
}
