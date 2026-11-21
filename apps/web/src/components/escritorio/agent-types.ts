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
  internalName: string | null;
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

export interface AdsRunResult {
  agentKey: 'giro-ads';
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: string | null;
  account: { id: string; name: string };
  metrics: { investimento: string | null; receitaAtribuida: null; roas: null; acos: null; motivoRoasAcos: string };
  period: { inicio: string | null; fim: string | null };
  origem: { linhasImportadas: number; ficheirosImportados: number; fonte: string };
  findings: AgentResult['findings'];
  recommendations: AgentResult['recommendations'];
  analista: { status: string; runId: string | null; runAt: string | null };
  caveats: string[];
}

export interface MesaReuniao {
  temResultados: boolean;
  agentes: Array<{
    agentKey: string;
    publicName: string;
    internalName: string;
    estado: 'NUNCA_EXECUTADO' | 'EM_EXECUCAO' | 'CONCLUIDO' | 'BLOQUEADO' | 'FALHOU';
    execucaoId: string | null;
    dataExecucao: string | null;
    motivo: string | null;
    achadosPrincipais: string[];
  }>;
  problemas: Array<{ agente: string; titulo: string }>;
  prioridades: Array<{ ordem: number; agente: string; titulo: string; severidade: 'risco' | 'pendencia' }>;
  recomendacoes: Array<{ agente: string; texto: string }>;
  pendencias: Array<{ agente: string; titulo: string }>;
}

export interface GestorRunResult {
  agentKey: 'central-farma';
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: string | null;
  account: { id: string; name: string };
  summary: AgentResult['summary'] | null;
  findings: AgentResult['findings'];
  recommendations: AgentResult['recommendations'];
  consolidation: { responsavelCalculo: string | null; papelGestor: string; mesa: MesaReuniao };
  sources: Array<{ name: string; description: string; count: number }>;
  caveats: string[];
}

export interface CatalogoRunResult {
  agentKey: 'vitrine-farma';
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: string | null;
  account: { id: string; name: string };
  summary: { skusVendidos: number; comCadastro: number; semCadastro: number; comCustoAprovado: number; unidadesVendidas: number };
  findings: AgentResult['findings'];
  recommendations: AgentResult['recommendations'];
  sources: Array<{ name: string; description: string; count: number }>;
  caveats: string[];
}
