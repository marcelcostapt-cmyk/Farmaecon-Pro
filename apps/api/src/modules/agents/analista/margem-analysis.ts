import type { Prisma } from '@prisma/client';
import type { MarginAlert, MarginGroupLine, MarginPreview } from '../../costs/margin-preview';
import type { FeeChange } from '../../costs/fee-change';

// Análise de leitura da Central Farma. Função PURA: recebe dados já lidos de serviços reais
// (margem por SKU, alertas, variação de taxas, contagens) e devolve achados determinísticos.
// Nunca fabrica número: campos sem dado ficam fora da conta e são declarados como pendência.

export const BLOCK_REASONS = {
  ACCOUNT_DISCONNECTED: 'CONTA_DESCONECTADA',
  NO_ORDERS: 'SEM_PEDIDOS',
  NO_APPROVED_COSTS: 'SEM_CUSTOS_APROVADOS',
} as const;
export type BlockReason = (typeof BLOCK_REASONS)[keyof typeof BLOCK_REASONS];

export interface AnalysisInput {
  account: { id: string; name: string; status: 'ACTIVE' | 'WARNING' | 'DISCONNECTED' };
  counts: { orders: number; approvedCosts: number; marginRules: number };
  preview: MarginPreview;
  alerts: MarginAlert[];
  feeChanges: FeeChange[];
}

export type FindingSeverity = 'risco' | 'pendencia' | 'info';

export interface Finding {
  id: string;
  severity: FindingSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | null>;
}

export interface Recommendation {
  text: string;
  basedOn: string[]; // ids de achados
}

export interface SourceRef {
  name: string;
  description: string;
  count: number;
}

export interface AnalysisResult {
  agentKey: 'dose-certa' | 'central-farma';
  consolidation?: { responsavelCalculo: 'dose-certa'; papelGestor: string };
  account: { id: string; name: string };
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: BlockReason | null;
  summary: {
    skusAnalysed: number;
    skusAvailable: number;
    skusUnavailable: number;
    unavailableBy: { semTaxa: number; semCustoPublicado: number; custoNaoAprovado: number };
    revenue: string;
    alertsBelowLimit: number;
    feeIncreases: number;
    feeDecreases: number;
  };
  findings: Finding[];
  recommendations: Recommendation[];
  sources: SourceRef[];
  caveats: string[];
}

const MAX_LISTED = 20;

export const ANALYSIS_CAVEATS: string[] = [
  'Margem líquida por SKU = receita − taxas ML (sale_fee) − CMV aprovado. Não é DRE: liquidações, reembolsos, frete e despesas não estão reconciliados.',
  'Só entram SKUs com custo publicado APROVADO e taxa ML registada. Os restantes ficam como indisponíveis, sem valor estimado.',
  'Análise de leitura: não altera preços, anúncios, campanhas, estoque nem nada no Mercado Livre.',
];

function unavailableReason(line: MarginGroupLine): 'semTaxa' | 'semCustoPublicado' | 'custoNaoAprovado' | null {
  if (line.status === 'disponivel') return null;
  if (line.fees === null) return 'semTaxa';
  if (line.costStatus === 'unavailable') return 'semCustoPublicado';
  return 'custoNaoAprovado';
}

function percent(value: Prisma.Decimal | null): string | null {
  return value === null ? null : value.toFixed(1);
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

/** Bloqueio por dependência (sem executar a análise). Null quando a análise pode correr. */
export function blockReasonFor(input: Pick<AnalysisInput, 'account' | 'counts'>): BlockReason | null {
  if (input.account.status === 'DISCONNECTED') return BLOCK_REASONS.ACCOUNT_DISCONNECTED;
  if (input.counts.orders === 0) return BLOCK_REASONS.NO_ORDERS;
  if (input.counts.approvedCosts === 0) return BLOCK_REASONS.NO_APPROVED_COSTS;
  return null;
}

export function analyseFinancialMargin(input: AnalysisInput): AnalysisResult {
  const { account, counts, preview, alerts, feeChanges } = input;
  const blockReason = blockReasonFor({ account, counts });
  const sources: SourceRef[] = [
    { name: 'orders', description: 'Pedidos sincronizados da conta (Mercado Livre)', count: counts.orders },
    { name: 'product_costs', description: 'Custos publicados com estado APPROVED', count: counts.approvedCosts },
    { name: 'margin_rules', description: 'Limites de margem configurados no tenant', count: counts.marginRules },
    { name: 'margin.preview', description: 'Margem líquida por SKU (MarginService)', count: preview.lines.length },
    { name: 'margin.fee-changes', description: 'Variação da taxa efetiva ML entre meses (≥ 2 pp)', count: feeChanges.length },
  ];

  const emptySummary = {
    skusAnalysed: 0,
    skusAvailable: 0,
    skusUnavailable: 0,
    unavailableBy: { semTaxa: 0, semCustoPublicado: 0, custoNaoAprovado: 0 },
    revenue: money(preview.totals.revenue),
    alertsBelowLimit: 0,
    feeIncreases: 0,
    feeDecreases: 0,
  };

  if (blockReason !== null) {
    return { agentKey: 'dose-certa', account: { id: account.id, name: account.name }, status: 'BLOCKED', blockReason, summary: emptySummary, findings: [], recommendations: [], sources, caveats: ANALYSIS_CAVEATS };
  }

  const unavailableBy = { semTaxa: 0, semCustoPublicado: 0, custoNaoAprovado: 0 };
  for (const line of preview.lines) {
    const reason = unavailableReason(line);
    if (reason) unavailableBy[reason] += 1;
  }
  const skusAvailable = preview.lines.filter((l) => l.status === 'disponivel').length;
  const skusUnavailable = preview.lines.length - skusAvailable;
  const increases = feeChanges.filter((c) => c.deltaPp.greaterThan(0));
  const decreases = feeChanges.filter((c) => c.deltaPp.lessThan(0));

  const findings: Finding[] = [];
  const recommendations: Recommendation[] = [];

  findings.push({
    id: 'cobertura',
    severity: skusUnavailable > 0 ? 'pendencia' : 'info',
    title: `${skusAvailable} de ${preview.lines.length} SKUs com margem calculável`,
    detail:
      skusUnavailable > 0
        ? `${skusUnavailable} SKU(s) ficam sem margem: taxa ML ausente (${unavailableBy.semTaxa}), sem custo publicado (${unavailableBy.semCustoPublicado}) ou com custo não aprovado (${unavailableBy.custoNaoAprovado}).`
        : 'Todos os SKUs analisados têm custo aprovado e taxa ML.',
    evidence: { disponiveis: skusAvailable, indisponiveis: skusUnavailable, semTaxa: unavailableBy.semTaxa, semCustoPublicado: unavailableBy.semCustoPublicado, custoNaoAprovado: unavailableBy.custoNaoAprovado },
  });

  if (counts.marginRules === 0) {
    findings.push({
      id: 'sem-limites',
      severity: 'pendencia',
      title: 'Nenhum limite de margem configurado',
      detail: 'Sem limites não há alertas de margem. Configure um limite global ou por SKU.',
      evidence: { regras: 0 },
    });
    recommendations.push({ text: 'Configurar um limite de margem mínima (global ou por SKU) para ativar os alertas.', basedOn: ['sem-limites'] });
  }

  const listedAlerts = alerts.slice(0, MAX_LISTED);
  listedAlerts.forEach((alert, index) => {
    const id = `alerta-${index + 1}`;
    const label = alert.sku ?? 'sem SKU';
    findings.push({
      id,
      severity: 'risco',
      title: `SKU ${label} abaixo do limite de margem`,
      detail: `Margem de ${percent(alert.marginPercent) ?? 'n/d'}% contra limite de ${percent(alert.limitPercent) ?? 'n/d'}%.`,
      evidence: { sku: alert.sku, descricao: alert.description, margemPercent: percent(alert.marginPercent), limitePercent: percent(alert.limitPercent), limiteValor: alert.limitAmount === null ? null : money(alert.limitAmount) },
    });
    recommendations.push({ text: `Rever preço de venda ou custo aprovado do SKU ${label} (margem abaixo do limite).`, basedOn: [id] });
  });

  feeChanges.slice(0, MAX_LISTED).forEach((change, index) => {
    const id = `taxa-${index + 1}`;
    const up = change.deltaPp.greaterThan(0);
    findings.push({
      id,
      severity: up ? 'risco' : 'info',
      title: `Taxa ML do SKU ${change.sku} ${up ? 'subiu' : 'caiu'} ${change.deltaPp.abs().toFixed(1)} pp`,
      detail: `De ${change.fromRatePercent.toFixed(1)}% (${change.fromMonth}) para ${change.toRatePercent.toFixed(1)}% (${change.toMonth}).`,
      evidence: { sku: change.sku, descricao: change.description, deMes: change.fromMonth, paraMes: change.toMonth, taxaAnterior: change.fromRatePercent.toFixed(1), taxaAtual: change.toRatePercent.toFixed(1), deltaPp: change.deltaPp.toFixed(1) },
    });
    if (up) recommendations.push({ text: `Verificar o impacto da alta de taxa ML no SKU ${change.sku} antes de manter o preço.`, basedOn: [id] });
  });

  return {
    agentKey: 'dose-certa',
    account: { id: account.id, name: account.name },
    status: 'COMPLETED',
    blockReason: null,
    summary: {
      skusAnalysed: preview.lines.length,
      skusAvailable,
      skusUnavailable,
      unavailableBy,
      revenue: money(preview.totals.revenue),
      alertsBelowLimit: alerts.length,
      feeIncreases: increases.length,
      feeDecreases: decreases.length,
    },
    findings,
    recommendations,
    sources,
    caveats: ANALYSIS_CAVEATS,
  };
}
