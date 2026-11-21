'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { accountLabel, type AccountOption } from '@/lib/escritorio-account';

export interface RunnableAgent {
  key: string;
  publicName: string;
  internalName: string | null;
}

// Disparo explícito pelo utilizador. A execução é de leitura: nunca altera o Mercado Livre.
export function RunAgentPanel({ accounts, selectedId, agents }: { accounts: AccountOption[]; selectedId: string | null; agents: RunnableAgent[] }) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(selectedId ?? accounts[0]?.id ?? '');
  const [agentKey, setAgentKey] = useState(agents[0]?.key ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agentKey)}/runs`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const result = (await response.json().catch(() => null)) as { ok: boolean; data?: { id: string }; message?: string } | null;
      if (!result?.ok || !result.data) {
        setError(result?.message ?? 'Não foi possível executar a análise.');
        return;
      }
      router.push(`/escritorio/execucoes/${result.data.id}`);
    } catch {
      setError('Sem ligação ao servidor. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  if (agents.length === 0) {
    return <p className="text-sm text-[var(--fa-muted)]">Nenhum agente executável nesta versão.</p>;
  }

  if (accounts.length === 0) {
    return (
      <p className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4 text-sm text-[var(--fa-muted)]">
        Ligue uma conta do Mercado Livre em Integrações para executar a Central Farma.
      </p>
    );
  }

  return (
    <section id="executar-agente" aria-labelledby="run-agent-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5 shadow-[var(--fa-sh-1)]">
      <h2 id="run-agent-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">
        Executar agente
      </h2>
      <p className="mt-1 text-xs text-[var(--fa-muted)]">
        Análise de leitura com os dados já sincronizados da conta: margem por SKU, alertas de limite e variação de taxas ML.
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[var(--fa-muted)]">
          Agente
          <select
            value={agentKey}
            onChange={(event) => setAgentKey(event.target.value)}
            className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] bg-[var(--fa-bg)] px-3 py-2 text-sm text-[var(--fa-navy)]"
          >
            {agents.map((agent) => (
              <option key={agent.key} value={agent.key}>
                {agent.publicName}
                {agent.internalName ? ` (interno: ${agent.internalName})` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[var(--fa-muted)]">
          Conta
          <select
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
            className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] bg-[var(--fa-bg)] px-3 py-2 text-sm text-[var(--fa-navy)]"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {accountLabel(account)}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={run}
          disabled={pending || !accountId || !agentKey}
          className="rounded-[var(--fa-r-md)] bg-[var(--fa-navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {pending ? 'Executando…' : 'Executar análise'}
        </button>
      </div>
      {error ? (
        <p role="alert" className="mt-3 text-sm text-[var(--fa-neg)]">
          {error}
        </p>
      ) : null}
    </section>
  );
}
