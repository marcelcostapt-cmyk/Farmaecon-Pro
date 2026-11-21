import { AgentStatusList } from '@/components/escritorio/AgentStatusList';
import { OfficeScene } from '@/components/escritorio/OfficeScene';
import type { AgentCatalogItem } from '@/components/escritorio/agent-types';
import { MargemResumoCard } from '@/components/escritorio/MargemResumoCard';
import { LotesResumoCard } from '@/components/escritorio/LotesResumoCard';
import { fetchApi } from '@/lib/api';
import { accountLabel, resolveSelectedAccount, type AccountOption } from '@/lib/escritorio-account';
import { isNextControlError } from '@/lib/next-errors';
import { RunAgentPanel } from './run-agent-panel';

async function loadAgents(): Promise<AgentCatalogItem[] | null> {
  try {
    return (await fetchApi<AgentCatalogItem[]>('/agents')).data;
  } catch (error) {
    if (isNextControlError(error)) throw error;
    return null;
  }
}

async function loadAccounts(): Promise<AccountOption[]> {
  try {
    return (await fetchApi<AccountOption[]>('/integrations')).data;
  } catch (error) {
    if (isNextControlError(error)) throw error;
    return [];
  }
}

export default async function EscritorioPage({ searchParams }: { searchParams: Promise<{ conta?: string }> }) {
  const { conta } = await searchParams;
  const [agents, accounts] = await Promise.all([loadAgents(), loadAccounts()]);
  const selected = resolveSelectedAccount(accounts, conta);

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--fa-navy)]">Escritório Virtual</h1>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--fa-orange-bg)] px-3 py-1 text-xs font-semibold text-[var(--fa-orange-700)] ring-1 ring-[color:var(--fa-orange)]/30">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-[var(--fa-orange)]" />
            Modo Observação
          </span>
        </div>
        <p className="max-w-2xl text-sm text-[var(--fa-muted)]">
          Os agentes analisam dados reais e recomendam. Nesta fase não alteram preços, anúncios, campanhas nem estoque.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-3 rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[var(--fa-muted)]">
          Conta em análise
          <select name="conta" defaultValue={selected?.id ?? ''} className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] bg-[var(--fa-bg)] px-3 py-2 text-sm text-[var(--fa-navy)]">
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] px-4 py-2 text-sm font-semibold text-[var(--fa-navy)]">
          Ver conta
        </button>
      </form>

      <RunAgentPanel accounts={accounts} selectedId={selected?.id ?? null} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <OfficeScene agents={agents} unavailable={agents === null} />
        <AgentStatusList agents={agents} unavailable={agents === null} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MargemResumoCard
          accountId={selected?.id ?? null}
          scopeLabel={selected ? `Conta: ${accountLabel(selected)}` : 'Sem conta: nenhum dado de margem'}
        />
        <LotesResumoCard />
      </div>
    </div>
  );
}
