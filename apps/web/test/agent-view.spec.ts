import { agentStatus } from '../src/components/escritorio/agent-view';
import type { AgentCatalogItem, AgentRunSummary } from '../src/components/escritorio/agent-types';

function agent(partial: Partial<AgentCatalogItem> = {}): AgentCatalogItem {
  return { key: 'central-farma', name: 'Central Farma', sector: 'Orquestração', description: '', implemented: true, latestRun: null, ...partial };
}

function run(status: AgentRunSummary['status']): AgentRunSummary {
  return { id: 'r', agentKey: 'central-farma', accountId: 'a', status, blockReason: null, errorMessage: null, startedAt: '2026-11-21T10:00:00Z', finishedAt: null };
}

describe('escritório — estado visual vindo do backend', () => {
  it('agente implementado sem execução é "Nunca executado", nunca ativo', () => {
    expect(agentStatus(agent())).toBe('nunca-executado');
  });

  it('agente não implementado nunca aparece como ativo, mesmo com execução antiga', () => {
    expect(agentStatus(agent({ implemented: false }))).toBe('nao-implementado');
    expect(agentStatus(agent({ implemented: false, latestRun: run('COMPLETED') }))).toBe('nao-implementado');
  });

  it('cada estado de execução tem rótulo próprio', () => {
    expect(agentStatus(agent({ latestRun: run('RUNNING') }))).toBe('em-execucao');
    expect(agentStatus(agent({ latestRun: run('COMPLETED') }))).toBe('concluido');
    expect(agentStatus(agent({ latestRun: run('BLOCKED') }))).toBe('bloqueado-dependencia');
    expect(agentStatus(agent({ latestRun: run('FAILED') }))).toBe('falhou');
  });

  it('sem resposta da API o estado é indisponível, não offline nem ativo', () => {
    expect(agentStatus(null)).toBe('indisponivel');
    expect(agentStatus(agent({ latestRun: run('COMPLETED') }), true)).toBe('indisponivel');
  });
});
