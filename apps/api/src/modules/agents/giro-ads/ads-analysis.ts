import { Prisma } from '@prisma/client';

// Análise de leitura do GIRO ADS (agente público: ADS). Função PURA.
// Reutiliza o que já existe: custos de ADS importados (AdsService.profile) e o último resultado
// concluído do ANALISTA (margem por SKU). Não calcula margem, não mistura investimento com DRE e
// não atribui vendas: ROAS e ACOS só existem quando há receita atribuída confiável (hoje não há).

export const ADS_BLOCK_REASONS = {
  ACCOUNT_DISCONNECTED: 'CONTA_DESCONECTADA',
  NO_ADS_DATA: 'SEM_DADOS_ADS',
} as const;
export type AdsBlockReason = (typeof ADS_BLOCK_REASONS)[keyof typeof ADS_BLOCK_REASONS];

/** Limites das regras (explícitos e verificáveis). */
export const ADS_RULES = {
  UNALLOCATED_RISK_PCT: 20, // gasto sem SKU acima deste percentual vira risco
  CAMPAIGN_CONCENTRATION_PCT: 50, // uma campanha com mais deste percentual do gasto é concentração
} as const;

export interface AdsProfile {
  rows: number;
  firstDay: string | null; // AAAA-MM-DD
  lastDay: string | null;
  importBatches: number; // ficheiros distintos (sourceHash)
  total: Prisma.Decimal;
  unallocated: Prisma.Decimal;
  bySku: Array<{ sku: string; amount: Prisma.Decimal }>;
  byCampaign: Array<{ campaign: string; amount: Prisma.Decimal }>;
}

export interface AnalistaContext {
  status: 'COMPLETED' | 'NOT_RUN' | 'BLOCKED' | 'FAILED';
  runId: string | null;
  runAt: string | null;
  marginAlertSkus: string[]; // SKUs com alerta de margem no último resultado concluído do Analista
}

export interface AdsAnalysisInput {
  account: { id: string; name: string; status: 'ACTIVE' | 'WARNING' | 'DISCONNECTED' };
  profile: AdsProfile | null; // null = sem linhas de ADS importadas
  analista: AnalistaContext;
}

export type AdsFindingSeverity = 'risco' | 'pendencia' | 'info';

export interface AdsFinding {
  id: string;
  severity: AdsFindingSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | null>;
}

export interface AdsResult {
  agentKey: 'giro-ads';
  account: { id: string; name: string };
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: AdsBlockReason | null;
  metrics: {
    investimento: string | null;
    receitaAtribuida: null;
    roas: null;
    acos: null;
    motivoRoasAcos: string;
  };
  period: { inicio: string | null; fim: string | null };
  origem: { linhasImportadas: number; ficheirosImportados: number; fonte: 'ads_costs (CSV importado)' };
  findings: AdsFinding[];
  recommendations: Array<{ text: string; basedOn: string[] }>;
  analista: AnalistaContext;
  caveats: string[];
}

export const ADS_CAVEATS: string[] = [
  'Investimento em ADS é custo de publicidade importado de CSV. Não é misturado com o DRE reconciliado.',
  'Receita de campanhas não é lucro. Vendas orgânicas não são atribuídas à publicidade.',
  'ROAS e ACOS só são calculados com receita atribuída confiável. Os CSV atuais não a contêm.',
  'Análise de leitura: não altera campanhas, verbas, anúncios, promoções nem preços no Mercado Livre.',
];

const ROAS_UNAVAILABLE = 'Os dados importados não têm vendas atribuídas às campanhas. ROAS e ACOS não são calculados.';

/** ROAS = receita atribuída ÷ investimento. Null sem receita confiável ou sem investimento. */
export function computeRoas(spend: Prisma.Decimal, attributedRevenue: Prisma.Decimal | null): Prisma.Decimal | null {
  if (attributedRevenue === null || spend.isZero()) return null;
  return attributedRevenue.div(spend);
}

/** ACOS (%) = investimento ÷ receita atribuída × 100. Null sem receita (nunca divide por zero). */
export function computeAcos(spend: Prisma.Decimal, attributedRevenue: Prisma.Decimal | null): Prisma.Decimal | null {
  if (attributedRevenue === null || attributedRevenue.isZero()) return null;
  return spend.div(attributedRevenue).mul(100);
}

function pct(part: Prisma.Decimal, total: Prisma.Decimal): Prisma.Decimal {
  return total.isZero() ? new Prisma.Decimal(0) : part.div(total).mul(100);
}

export function blockReasonFor(input: Pick<AdsAnalysisInput, 'account' | 'profile'>): AdsBlockReason | null {
  if (input.account.status === 'DISCONNECTED') return ADS_BLOCK_REASONS.ACCOUNT_DISCONNECTED;
  if (input.profile === null || input.profile.rows === 0) return ADS_BLOCK_REASONS.NO_ADS_DATA;
  return null;
}

export function analyseAds(input: AdsAnalysisInput): AdsResult {
  const { account, profile, analista } = input;
  const blockReason = blockReasonFor({ account, profile });
  const base = {
    agentKey: 'giro-ads' as const,
    account: { id: account.id, name: account.name },
    origem: { linhasImportadas: profile?.rows ?? 0, ficheirosImportados: profile?.importBatches ?? 0, fonte: 'ads_costs (CSV importado)' as const },
    analista,
    caveats: ADS_CAVEATS,
  };
  const metricsNone = { investimento: null, receitaAtribuida: null as null, roas: null as null, acos: null as null, motivoRoasAcos: ROAS_UNAVAILABLE };
  if (blockReason !== null || profile === null) {
    return { ...base, status: 'BLOCKED', blockReason, metrics: metricsNone, period: { inicio: null, fim: null }, findings: [], recommendations: [] };
  }

  const findings: AdsFinding[] = [];
  const recommendations: AdsResult['recommendations'] = [];
  const total = profile.total;

  findings.push({
    id: 'investimento',
    severity: 'info',
    title: `Investimento importado de R$ ${total.toFixed(2)}`,
    detail: `Período dos dados: ${profile.firstDay} a ${profile.lastDay}. ${profile.rows} linha(s) em ${profile.importBatches} ficheiro(s).`,
    evidence: { investimento: total.toFixed(2), inicio: profile.firstDay, fim: profile.lastDay, linhas: profile.rows, ficheiros: profile.importBatches },
  });

  // Regra 1: gasto sem SKU.
  if (profile.unallocated.greaterThan(0)) {
    const share = pct(profile.unallocated, total);
    const severity: AdsFindingSeverity = share.greaterThan(ADS_RULES.UNALLOCATED_RISK_PCT) ? 'risco' : 'pendencia';
    findings.push({
      id: 'sem-sku',
      severity,
      title: `${share.toFixed(1)}% do investimento sem SKU associado`,
      detail: `R$ ${profile.unallocated.toFixed(2)} não podem ser relacionados a um produto. Regra: acima de ${ADS_RULES.UNALLOCATED_RISK_PCT}% é risco.`,
      evidence: { semSku: profile.unallocated.toFixed(2), percentual: share.toFixed(1), limitePercent: ADS_RULES.UNALLOCATED_RISK_PCT },
    });
    recommendations.push({ text: 'Associar o gasto a SKU no relatório de campanhas antes de avaliar desempenho por produto.', basedOn: ['sem-sku'] });
  }

  // Regra 2: concentração em uma campanha.
  const top = [...profile.byCampaign].sort((a, b) => b.amount.comparedTo(a.amount))[0];
  if (top) {
    const share = pct(top.amount, total);
    if (share.greaterThan(ADS_RULES.CAMPAIGN_CONCENTRATION_PCT)) {
      findings.push({
        id: 'concentracao',
        severity: 'info',
        title: `Campanha ${top.campaign} concentra ${share.toFixed(1)}% do investimento`,
        detail: `Regra: acima de ${ADS_RULES.CAMPAIGN_CONCENTRATION_PCT}% é concentração. Sem vendas atribuídas, o retorno desta campanha não é verificável.`,
        evidence: { campanha: top.campaign, gasto: top.amount.toFixed(2), percentual: share.toFixed(1) },
      });
      recommendations.push({ text: `Verificar o retorno da campanha ${top.campaign} quando houver vendas atribuídas antes de manter a concentração.`, basedOn: ['concentracao'] });
    }
  }

  // Regra 3: investimento em SKU com margem abaixo do limite (cruzamento com o Analista).
  if (analista.status === 'COMPLETED') {
    const flagged = profile.bySku.filter((s) => analista.marginAlertSkus.includes(s.sku));
    flagged.forEach((s, index) => {
      const id = `margem-${index + 1}`;
      findings.push({
        id,
        severity: 'risco',
        title: `SKU ${s.sku} recebe investimento e tem margem abaixo do limite`,
        detail: `Investimento de R$ ${s.amount.toFixed(2)} em SKU com alerta de margem no último resultado do Analista (${analista.runAt}).`,
        evidence: { sku: s.sku, investimento: s.amount.toFixed(2), analistaExecucao: analista.runId, analistaEm: analista.runAt },
      });
      recommendations.push({ text: `Rever o investimento no SKU ${s.sku} antes de aumentar a verba. A decisão é humana.`, basedOn: [id] });
    });
  } else {
    findings.push({
      id: 'margem-nao-avaliada',
      severity: 'pendencia',
      title: 'Margem não avaliada no cruzamento com ADS',
      detail: `O Analista não tem execução concluída (estado: ${analista.status}). Execute o Analista para cruzar investimento e margem.`,
      evidence: { analistaEstado: analista.status },
    });
  }

  // Regra 4: sempre que não há receita atribuída.
  findings.push({
    id: 'sem-receita-atribuida',
    severity: 'pendencia',
    title: 'ROAS e ACOS indisponíveis',
    detail: ROAS_UNAVAILABLE,
    evidence: { roas: null, acos: null },
  });
  recommendations.push({ text: 'Importar relatório de campanhas com vendas atribuídas para calcular ROAS e ACOS.', basedOn: ['sem-receita-atribuida'] });

  return {
    ...base,
    status: 'COMPLETED',
    blockReason: null,
    metrics: { investimento: total.toFixed(2), receitaAtribuida: null, roas: null, acos: null, motivoRoasAcos: ROAS_UNAVAILABLE },
    period: { inicio: profile.firstDay, fim: profile.lastDay },
    findings,
    recommendations,
  };
}
