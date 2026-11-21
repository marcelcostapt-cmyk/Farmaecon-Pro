import { StatusBadge } from './StatusBadge';
import { agentStatus } from './agent-view';
import type { AgentCatalogItem } from './agent-types';

import Link from 'next/link';

function when(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
}

// Vista do escritório: um cartão por agente, com o estado da última execução real.
export function OfficeScene({ agents, unavailable = false }: { agents: AgentCatalogItem[] | null; unavailable?: boolean }) {
  return (
    <section
      aria-labelledby="office-scene-title"
      className="overflow-hidden rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] shadow-[var(--fa-sh-1)]"
    >
      <div className="border-b border-[var(--fa-border)] px-5 py-4">
        <h2 id="office-scene-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">
          Visão do escritório
        </h2>
        <p className="mt-1 text-xs text-[var(--fa-muted)]">
          Cada cartão mostra o estado registado pela API. Só a Central Farma executa análises nesta versão.
        </p>
      </div>

      <div className="bg-[var(--fa-bg)] p-5">
        <div className="grid min-h-[22rem] grid-cols-1 gap-4 sm:grid-cols-2">
          {(agents ?? []).map((agent, index) => (
            <article
              key={agent.key}
              className="flex min-h-40 flex-col justify-between rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4 shadow-[var(--fa-sh-1)]"
              style={{ borderTop: `4px solid var(--fa-ag-${agent.accent})` }}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold text-[var(--fa-muted)]">{agent.sector}</span>
                <StatusBadge status={agentStatus(agent, unavailable)} />
              </div>
              <div>
                <h3 className="text-[14px] font-extrabold text-[var(--fa-navy)]">{agent.publicName}</h3>
                <p className="mt-1 text-sm text-[var(--fa-muted)]">{agent.description}</p>
                <p className="mt-2 text-xs text-[var(--fa-muted-2)]">
                  {agent.latestRun ? `Última execução: ${when(agent.latestRun.startedAt)}` : 'Sem execução registada.'}
                  {agent.internalName ? ` · interno: ${agent.internalName}` : ''}
                </p>
              </div>
              <div className="mt-3">
                {agent.latestRun ? (
                  <Link href={`/escritorio/execucoes/${agent.latestRun.id}`} className="text-xs font-semibold text-[var(--fa-orange-700)]">
                    Ver agente →
                  </Link>
                ) : (
                  <a href="#executar-agente" className="text-xs font-semibold text-[var(--fa-orange-700)]">
                    Ver agente →
                  </a>
                )}
              </div>
            </article>
          ))}
          {agents === null ? (
            <p className="col-span-full text-sm text-[var(--fa-muted)]">Não foi possível carregar o escritório agora.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
