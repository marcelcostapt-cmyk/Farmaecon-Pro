import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import { agentStatus } from './agent-view';
import type { AgentCatalogItem } from './agent-types';

// Lista dos agentes com o estado vindo do backend. Sem dados (`unavailable`), mostra "Estado indisponível".
export function AgentStatusList({ agents, unavailable = false }: { agents: AgentCatalogItem[] | null; unavailable?: boolean }) {
  return (
    <section
      aria-labelledby="agent-status-title"
      className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4 shadow-[var(--fa-sh-1)]"
    >
      <div className="mb-3">
        <h2 id="agent-status-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">
          Setores e agentes
        </h2>
        <p className="mt-1 text-xs text-[var(--fa-muted)]">
          Estados vindos de execuções registadas. Agente sem execução aparece como “Nunca executado”.
        </p>
      </div>

      <ul className="space-y-2">
        {(agents ?? []).map((agent) => (
          <li
            key={agent.key}
            className="flex items-center justify-between gap-3 rounded-[var(--fa-r-md)] px-3 py-2 hover:bg-[var(--fa-bg)]"
          >
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-[var(--fa-navy)]">{agent.publicName}</p>
              <p className="truncate text-xs text-[var(--fa-muted)]">{agent.sector}{agent.internalName ? ` · interno: ${agent.internalName}` : ''}</p>
              {agent.latestRun ? (
                <Link href={`/escritorio/execucoes/${agent.latestRun.id}`} className="text-xs font-semibold text-[var(--fa-orange-700)]">
                  ver última execução →
                </Link>
              ) : null}
            </div>
            <StatusBadge status={agentStatus(agent, unavailable)} />
          </li>
        ))}
        {agents === null ? (
          <li className="px-3 py-2 text-sm text-[var(--fa-muted)]">Não foi possível carregar os agentes agora.</li>
        ) : null}
      </ul>
    </section>
  );
}
