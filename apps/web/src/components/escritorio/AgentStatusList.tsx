import { StatusBadge, type AgentStatus } from './StatusBadge';

export interface Agent {
  id: string;
  name: string;
  sector: string;
  status: AgentStatus;
}

const AGENTS: Agent[] = [
  { id: 'gestor', name: 'Gestor', sector: 'Coordenação', status: 'active' },
  { id: 'analista', name: 'Analista', sector: 'Preços e desempenho', status: 'active' },
  { id: 'anuncios', name: 'Anúncios', sector: 'Catálogo e conteúdo', status: 'attention' },
  { id: 'criativo', name: 'Criativo', sector: 'Peças e identidade', status: 'idle' },
  { id: 'ads', name: 'ADS', sector: 'Campanhas e métricas', status: 'idle' },
  { id: 'sac', name: 'SAC', sector: 'Perguntas e reclamações', status: 'blocked' },
];

export function AgentStatusList({ agents = AGENTS }: { agents?: Agent[] }) {
  return (
    <section
      aria-labelledby="agent-status-title"
      className="rounded-2xl border border-border bg-card p-4 shadow-sm"
    >
      <div className="mb-3">
        <h2 id="agent-status-title" className="text-sm font-semibold">
          Setores e agentes
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Estado demonstrativo até a sincronização real.
        </p>
      </div>

      <ul className="space-y-2">
        {agents.map((agent) => (
          <li
            key={agent.id}
            className="flex items-center justify-between gap-3 rounded-xl px-3 py-2 hover:bg-accent"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{agent.name}</p>
              <p className="truncate text-xs text-muted-foreground">{agent.sector}</p>
            </div>
            <StatusBadge status={agent.status} />
          </li>
        ))}
      </ul>
    </section>
  );
}
