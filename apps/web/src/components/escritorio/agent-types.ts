// Contratos do escritório de agentes (espelham a API em modules/agents). Os estados vêm do backend.
export type AgentRunStatus = 'RUNNING' | 'COMPLETED' | 'BLOCKED' | 'FAILED';

export interface AgentRunSummary {
  id: string;
  agentKey: string;
  accountId: string;
  status: AgentRunStatus;
  blockReason: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export type AgentAccent = 'gestor' | 'analista' | 'anuncios' | 'criativo' | 'ads' | 'sac';

export interface AgentCatalogItem {
  key: string;
  publicName: string;
  internalName: string;
  accent: AgentAccent;
  sector: string;
  description: string;
  implemented: boolean;
  latestRun: AgentRunSummary | null;
}

export interface AgentRunDetail extends AgentRunSummary {
  result: AgentResult | null;
}

export interface AgentResult {
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: string | null;
  account: { id: string; name: string };
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
  findings: Array<{
    id: string;
    severity: 'risco' | 'pendencia' | 'info';
    title: string;
    detail: string;
    evidence: Record<string, string | number | null>;
  }>;
  recommendations: Array<{ text: string; basedOn: string[] }>;
  sources: Array<{ name: string; description: string; count: number }>;
  caveats: string[];
}
