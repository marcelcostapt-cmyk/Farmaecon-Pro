import type { AgentStatus } from './StatusBadge';
import type { AgentCatalogItem } from './agent-types';

// Traduz o estado real do backend para o rótulo visual. Sem execução = "Nunca executado"; nunca "ativo".
export function agentStatus(agent: AgentCatalogItem | null, unavailable = false): AgentStatus {
  if (unavailable || agent === null) return 'indisponivel';
  if (!agent.implemented) return 'nao-implementado';
  const run = agent.latestRun;
  if (run === null) return 'nunca-executado';
  switch (run.status) {
    case 'RUNNING':
      return 'em-execucao';
    case 'COMPLETED':
      return 'concluido';
    case 'BLOCKED':
      return 'bloqueado-dependencia';
    case 'FAILED':
      return 'falhou';
  }
}

/** Rótulo público (C2) de cada agente e a identificação interna correspondente. */
export function agentTitle(agent: Pick<AgentCatalogItem, 'publicName' | 'internalName'>): string {
  return agent.internalName ? `${agent.publicName} (${agent.internalName})` : agent.publicName;
}

export const BLOCK_REASON_TEXT: Record<string, string> = {
  CONTA_DESCONECTADA: 'A conta está desligada do Mercado Livre. Reconecte-a em Integrações.',
  SEM_PEDIDOS: 'Ainda não há pedidos sincronizados para esta conta.',
  SEM_CUSTOS_APROVADOS: 'Não há custos aprovados. Sem custo, a margem não é calculada.',
  SEM_DADOS_ADS: 'Não há custos de ADS importados para esta conta. Importe o relatório de campanhas para analisar o investimento.',
  SEM_RESULTADOS: 'Nenhum agente tem resultado concluído para esta conta. Execute o Analista e o Giro Ads antes da reunião.',
};
