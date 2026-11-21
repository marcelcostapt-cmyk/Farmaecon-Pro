import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge, type AgentStatus } from '@/components/escritorio/StatusBadge';
import { BLOCK_REASON_TEXT } from '@/components/escritorio/agent-view';
import type { AgentResult, AgentRunDetail, AgentRunStatus, AgentRunSummary } from '@/components/escritorio/agent-types';
import { fetchApi } from '@/lib/api';
import { isNextControlError } from '@/lib/next-errors';

// Execução registada: agente, conta, data/hora, estado, fontes, resultado, problemas, recomendações e histórico.
const AGENT_LABEL: Record<string, string> = {
  'central-farma': 'Gestor (interno: Central Farma)',
  'dose-certa': 'Analista (interno: Dose Certa)',
};
const SEVERITY_LABEL: Record<string, string> = { risco: 'Risco', pendencia: 'Pendência', info: 'Informação' };

const RUN_BADGE: Record<AgentRunStatus, AgentStatus> = {
  RUNNING: 'em-execucao',
  COMPLETED: 'concluido',
  BLOCKED: 'bloqueado-dependencia',
  FAILED: 'falhou',
};

function when(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'America/Sao_Paulo' });
}

export default async function AgentRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let run: AgentRunDetail;
  try {
    run = (await fetchApi<AgentRunDetail>(`/agents/runs/${encodeURIComponent(id)}`)).data;
  } catch (error) {
    if (isNextControlError(error)) throw error;
    notFound();
  }

  const [accounts, runs] = await Promise.all([
    fetchApi<Array<{ id: string; name: string; displayName: string | null }>>('/integrations').then((r) => r.data).catch(() => []),
    fetchApi<AgentRunSummary[]>(`/agents/runs?agent_key=${encodeURIComponent(run.agentKey)}&account_id=${encodeURIComponent(run.accountId)}&limit=10`)
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const account = accounts.find((a) => a.id === run.accountId);
  const accountName = account ? (account.displayName ?? account.name) : null;
  const result: AgentResult | null = run.result;
  const history = runs;

  return (
    <article className="mx-auto max-w-5xl space-y-6">
      <Link href="/escritorio" className="text-sm font-semibold text-[var(--fa-orange-700)]">← Escritório</Link>

      <header className="space-y-3">
        <h1 className="text-[28px] font-extrabold tracking-tight text-[var(--fa-navy)]">
          Execução · {AGENT_LABEL[run.agentKey] ?? run.agentKey}
        </h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--fa-muted)]">
          <StatusBadge status={RUN_BADGE[run.status]} />
          <span>Conta: {accountName ?? 'conta desconhecida ou removida'}</span>
          <span>Início: {when(run.startedAt)}</span>
          <span>Fim: {when(run.finishedAt)}</span>
        </div>
      </header>

      {run.status === 'BLOCKED' ? (
        <section role="status" className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-warn-bg)] p-4 text-sm text-[var(--fa-navy)]">
          <p className="font-semibold">Análise não executada por falta de dados.</p>
          <p className="mt-1">{(run.blockReason && BLOCK_REASON_TEXT[run.blockReason]) ?? run.blockReason ?? 'Dependência em falta.'}</p>
        </section>
      ) : null}

      {run.status === 'FAILED' ? (
        <section role="alert" className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-neg-bg)] p-4 text-sm text-[var(--fa-neg)]">
          {run.errorMessage ?? 'A análise falhou.'}
        </section>
      ) : null}

      {run.status === 'RUNNING' ? (
        <p className="text-sm text-[var(--fa-muted)]">Execução em curso. Atualize a página para ver o resultado final.</p>
      ) : null}

      {result && result.status === 'COMPLETED' ? (
        <>
          <section aria-labelledby="summary-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
            <h2 id="summary-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Resultado</h2>
            <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
              <Metric label="SKUs analisados" value={result.summary.skusAnalysed} />
              <Metric label="Com margem calculável" value={result.summary.skusAvailable} />
              <Metric label="Sem margem calculável" value={result.summary.skusUnavailable} />
              <Metric label="Abaixo do limite" value={result.summary.alertsBelowLimit} />
              <Metric label="Receita (período sincronizado)" value={`R$ ${result.summary.revenue}`} />
              <Metric label="Taxas ML em alta" value={result.summary.feeIncreases} />
              <Metric label="Taxas ML em queda" value={result.summary.feeDecreases} />
            </dl>
          </section>

          <section aria-labelledby="findings-title" className="space-y-3">
            <h2 id="findings-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Achados</h2>
            {result.findings.map((finding) => (
              <div key={finding.id} className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fa-muted)]">{SEVERITY_LABEL[finding.severity]}</p>
                <p className="mt-1 font-semibold text-[var(--fa-navy)]">{finding.title}</p>
                <p className="mt-1 text-sm text-[var(--fa-muted)]">{finding.detail}</p>
              </div>
            ))}
          </section>

          <section aria-labelledby="recs-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
            <h2 id="recs-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Recomendações (para decisão humana)</h2>
            {result.recommendations.length === 0 ? (
              <p className="mt-2 text-sm text-[var(--fa-muted)]">Nenhuma recomendação: não há achados que a exijam.</p>
            ) : (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--fa-navy)]">
                {result.recommendations.map((rec) => (
                  <li key={rec.text}>{rec.text}</li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}

      {result ? (
        <section aria-labelledby="sources-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
          <h2 id="sources-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Origem dos dados</h2>
          <ul className="mt-2 space-y-1 text-sm text-[var(--fa-navy)]">
            {result.sources.map((source) => (
              <li key={source.name}>
                <span className="font-mono text-xs">{source.name}</span> — {source.description}: <strong>{source.count}</strong>
              </li>
            ))}
          </ul>
          <div className="mt-4 space-y-1 text-xs text-[var(--fa-muted)]">
            {result.caveats.map((caveat) => (
              <p key={caveat}>{caveat}</p>
            ))}
          </div>
        </section>
      ) : null}

      <section aria-labelledby="history-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 id="history-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Histórico desta conta</h2>
        <ul className="mt-2 divide-y divide-[var(--fa-border)] text-sm">
          {history.map((item) => (
            <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <Link href={`/escritorio/execucoes/${item.id}`} className="font-semibold text-[var(--fa-navy)]">
                {when(item.startedAt)}
              </Link>
              <StatusBadge status={RUN_BADGE[item.status]} />
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs text-[var(--fa-muted)]">{label}</dt>
      <dd className="fa-num mt-1 text-xl font-extrabold text-[var(--fa-navy)]">{value}</dd>
    </div>
  );
}
