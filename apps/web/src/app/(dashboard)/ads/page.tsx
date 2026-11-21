import Link from 'next/link';
import { StatusBadge } from '@/components/escritorio/StatusBadge';
import type { AgentRunSummary } from '@/components/escritorio/agent-types';
import { fetchApi } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { formatBrl, formatDateBr, percentOf } from '@/lib/ads-upload';
import { accountLabel, resolveSelectedAccount, type AccountOption } from '@/lib/escritorio-account';
import { isNextControlError } from '@/lib/next-errors';
import { AdsImportPanel } from './ads-import-panel';
import { RunAdsButton } from './run-ads-button';

// Publicidade (ADS): investimento importado, distribuição por SKU e campanha, importação (ADMIN) e Giro Ads.
// Investimento de publicidade não é lucro e não entra no DRE. ROAS e ACOS dependem de receita atribuída.

interface Overview {
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
  importBatches: number;
  total: string;
  unallocated: string;
  bySku: Array<{ sku: string; amount: string }>;
  byCampaign: Array<{ campaign: string; amount: string }>;
}

async function loadAccounts(): Promise<AccountOption[]> {
  try {
    return (await fetchApi<AccountOption[]>('/integrations')).data;
  } catch (error) {
    if (isNextControlError(error)) throw error;
    return [];
  }
}

export default async function AdsPage({ searchParams }: { searchParams: Promise<{ conta?: string }> }) {
  const { conta } = await searchParams;
  const [accounts, user] = await Promise.all([loadAccounts(), getCurrentUser()]);
  const selected = resolveSelectedAccount(accounts, conta);
  const isAdmin = user?.role === 'ADMIN';

  let overview: Overview | null = null;
  let overviewError: string | null = null;
  let runs: AgentRunSummary[] = [];
  if (selected) {
    try {
      overview = (await fetchApi<Overview>(`/ads/overview?account_id=${encodeURIComponent(selected.id)}`)).data;
    } catch (error) {
      if (isNextControlError(error)) throw error;
      overviewError = 'Não foi possível carregar os indicadores desta conta.';
    }
    runs = await fetchApi<AgentRunSummary[]>(`/agents/runs?agent_key=giro-ads&account_id=${encodeURIComponent(selected.id)}&limit=5`)
      .then((r) => r.data)
      .catch(() => []);
  }

  return (
    <article className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--fa-navy)]">Publicidade (ADS)</h1>
        <p className="max-w-3xl text-sm text-[var(--fa-muted)]">
          Investimento em publicidade importado de relatório CSV. Não é lucro e não altera o DRE. ROAS e ACOS só são calculados com receita atribuída confiável.
        </p>
      </header>

      {accounts.length === 0 ? (
        <p className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4 text-sm text-[var(--fa-muted)]">
          Ligue uma conta do Mercado Livre em Integrações para ver a publicidade.
        </p>
      ) : (
        <form method="get" className="flex flex-wrap items-end gap-3 rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[var(--fa-muted)]">
            Conta
            <select name="conta" defaultValue={selected?.id ?? ''} className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] bg-[var(--fa-bg)] px-3 py-2 text-sm text-[var(--fa-navy)]">
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{accountLabel(a)}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] px-4 py-2 text-sm font-semibold text-[var(--fa-navy)]">Ver conta</button>
        </form>
      )}

      {selected && overviewError ? <p role="alert" className="text-sm text-[var(--fa-neg)]">{overviewError}</p> : null}

      {selected && overview ? (
        overview.rows === 0 ? (
          <section className="rounded-[var(--fa-r-xl)] border border-dashed border-[var(--fa-border)] bg-[var(--fa-surface)] p-6 text-sm text-[var(--fa-muted)]">
            <p className="font-semibold text-[var(--fa-navy)]">Nenhum investimento importado para {accountLabel(selected)}.</p>
            <p className="mt-1">Sem dados, o Giro Ads não gera análise. Importe o CSV de campanhas abaixo.</p>
          </section>
        ) : (
          <>
            <section aria-labelledby="ads-kpis" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
              <h2 id="ads-kpis" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Indicadores de {accountLabel(selected)}</h2>
              <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
                <Kpi label="Investimento importado" value={formatBrl(overview.total)} />
                <Kpi label="Período" value={overview.firstDay ? `${formatDateBr(overview.firstDay)} a ${formatDateBr(overview.lastDay)}` : '—'} />
                <Kpi label="Linhas e ficheiros" value={`${overview.rows} · ${overview.importBatches}`} />
                <Kpi label="Sem SKU" value={`${formatBrl(overview.unallocated)} (${percentOf(overview.unallocated, overview.total)})`} />
              </dl>
              <p className="mt-4 text-xs text-[var(--fa-muted)]">ROAS e ACOS: indisponíveis. Os relatórios importados não têm vendas atribuídas às campanhas.</p>
            </section>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Distribution title="Por SKU" rows={overview.bySku.map((r) => ({ name: r.sku, amount: r.amount }))} total={overview.total} />
              <Distribution title="Por campanha" rows={overview.byCampaign.map((r) => ({ name: r.campaign, amount: r.amount }))} total={overview.total} />
            </div>
          </>
        )
      ) : null}

      {selected ? (
        <section aria-labelledby="giro-title" className="space-y-3 rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
          <h2 id="giro-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Giro Ads (interno do agente ADS)</h2>
          <p className="text-xs text-[var(--fa-muted)]">Análise de leitura: investimento, cruzamento com a margem do Analista e recomendações para revisão humana.</p>
          <RunAdsButton accountId={selected.id} />
          {runs.length > 0 ? (
            <ul className="divide-y divide-[var(--fa-border)] text-sm">
              {runs.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <Link href={`/escritorio/execucoes/${r.id}`} className="font-semibold text-[var(--fa-navy)]">
                    {new Date(r.startedAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' })}
                  </Link>
                  <StatusBadge status={r.status === 'COMPLETED' ? 'concluido' : r.status === 'BLOCKED' ? 'bloqueado-dependencia' : r.status === 'FAILED' ? 'falhou' : 'em-execucao'} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {selected ? (
        isAdmin ? (
          <AdsImportPanel accountId={selected.id} accountLabel={accountLabel(selected)} />
        ) : (
          <section className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5 text-sm text-[var(--fa-muted)]">
            Apenas ADMIN pode importar custos de publicidade. Os indicadores acima são de leitura.
          </section>
        )
      ) : null}
    </article>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--fa-muted)]">{label}</dt>
      <dd className="fa-num mt-1 text-xl font-extrabold text-[var(--fa-navy)]">{value}</dd>
    </div>
  );
}

function Distribution({ title, rows, total }: { title: string; rows: Array<{ name: string; amount: string }>; total: string }) {
  return (
    <section className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
      <h2 className="text-[13px] font-extrabold text-[var(--fa-navy)]">{title}</h2>
      <table className="mt-3 w-full text-sm">
        <thead className="text-left text-xs text-[var(--fa-muted)]">
          <tr><th className="py-1">Nome</th><th className="py-1 text-right">Investimento</th><th className="py-1 text-right">Parte</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-t border-[var(--fa-border)]">
              <td className="py-1.5 text-[var(--fa-navy)]">{r.name}</td>
              <td className="fa-num py-1.5 text-right">{formatBrl(r.amount)}</td>
              <td className="fa-num py-1.5 text-right text-[var(--fa-muted)]">{percentOf(r.amount, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
