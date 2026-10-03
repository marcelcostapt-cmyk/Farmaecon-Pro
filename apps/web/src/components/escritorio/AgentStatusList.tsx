import { StatusBadge, type AgentStatus } from '@/components/escritorio/StatusBadge';

export interface Agent {
  id: string;
  name: string;
  sector: string;
  status: AgentStatus;
}

const AGENTS: Agent[] = [
  { id: 'gestor', name: 'Gestor', sector: 'Gestão', status: 'trabalhando' },
  { id: 'vendas', name: 'Vendas', sector: 'Comercial', status: 'trabalhando' },
  { id: 'estoque', name: 'Estoque', sector: 'Logística', status: 'ocioso' },
  { id: 'ads', name: 'Ads & Marketing', sector: 'Marketing', status: 'trabalhando' },
  { id: 'financeiro', name: 'Financeiro', sector: 'Finanças', status: 'ocioso' },
  { id: 'sac', name: 'SAC / Suporte', sector: 'Atendimento', status: 'offline' },
];

interface AgentStatusListProps {
  agents?: Agent[];
}

export function AgentStatusList({ agents = AGENTS }: AgentStatusListProps) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Setores e Agentes</h2>
      <ul className="space-y-2">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center justify-between rounded-xl px-3 py-2 hover:bg-gray-50"
          >
            <div>
              <p className="text-sm font-medium text-gray-900">{agent.name}</p>
              <p className="text-xs text-gray-500">{agent.sector}</p>
            </div>
            <StatusBadge status={agent.status} />
          </li>
        ))}
      </ul>
    </div>
  );
}
