import { StatusBadge } from './StatusBadge';
import { agentStatus } from './agent-view';
import type { AgentCatalogItem } from './agent-types';

const TONES = ['from-orange-100 to-amber-50', 'from-sky-100 to-cyan-50', 'from-violet-100 to-fuchsia-50', 'from-rose-100 to-pink-50', 'from-emerald-100 to-teal-50', 'from-slate-100 to-zinc-50'];

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
              className={`flex min-h-40 flex-col justify-between rounded-[var(--fa-r-lg)] bg-gradient-to-br ${TONES[index % TONES.length]} p-4 ring-1 ring-[color:var(--fa-navy)]/5 shadow-[var(--fa-sh-1)]`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--fa-muted-2)]">{agent.sector}</span>
                <StatusBadge status={agentStatus(agent, unavailable)} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[var(--fa-navy)]">{agent.name}</h3>
                <p className="mt-1 text-sm text-[var(--fa-muted)]">{agent.description}</p>
                <p className="mt-2 text-xs text-[var(--fa-muted-2)]">
                  {agent.latestRun ? `Última execução: ${when(agent.latestRun.startedAt)}` : 'Sem execução registada.'}
                </p>
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
