import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge, type AgentStatus } from '@/components/escritorio/StatusBadge';
import { BLOCK_REASON_TEXT } from '@/components/escritorio/agent-view';
import type {
  AdsRunResult,
  AgentResult,
  AgentRunDetail,
  AgentRunStatus,
  AgentRunSummary,
  GestorRunResult,
  MesaReuniao,
} from '@/components/escritorio/agent-types';
import { displayMetric, displayPeriod } from '@/lib/agent-result-view';
import { fetchApi } from '@/lib/api';
import { isNextControlError } from '@/lib/next-errors';

// Execução registada: agente, conta, data/hora, estado, fontes, resultado, problemas, recomendações e histórico.
const AGENT_LABEL: Record<string, string> = {
  'central-farma': 'Gestor (interno: Central Farma)',
  'dose-certa': 'Analista (interno: Dose Certa)',
  'giro-ads': 'ADS (interno: Giro Ads)',
};
const SEVERITY_LABEL: Record<string, string> = { risco: 'Risco', pendencia: 'Pendência', info: 'Informação' };
const RUN_BADGE: Record<AgentRunStatus, AgentStatus> = {
  RUNNING: 'em-execucao',
  COMPLETED: 'concluido',
  BLOCKED: 'bloqueado-dependencia',
  FAILED: 'falhou',
};
const ESTADO_BADGE: Record<MesaReuniao['agentes'][number]['estado'], AgentStatus> = {
  NUNCA_EXECUTADO: 'nunca-executado',
  EM_EXECUCAO: 'em-execucao',
  CONCLUIDO: 'concluido',
  BLOQUEADO: 'bloqueado-dependencia',
  FALHOU: 'falhou',
};
const ESTADO_TEXTO: Record<MesaReuniao['agentes'][number]['estado'], string> = {
  NUNCA_EXECUTADO: 'Nunca executado',
  EM_EXECUCAO: 'Em execução',
  CONCLUIDO: 'Concluído',
  BLOQUEADO: 'Bloqueado',
  FALHOU: 'Falhou',
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

  const [accounts, history] = await Promise.all([
    fetchApi<Array<{ id: string; name: string; displayName: string | null }>>('/integrations').then((r) => r.data).catch(() => []),
    fetchApi<AgentRunSummary[]>(`/agents/runs?agent_key=${encodeURIComponent(run.agentKey)}&account_id=${encodeURIComponent(run.accountId)}&limit=10`)
      .then((r) => r.data)
      .catch(() => []),
  ]);
  const account = accounts.find((a) => a.id === run.accountId);
  const accountName = account ? (account.displayName ?? account.name) : null;
  const raw = run.result as unknown;

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
          <p className="font-semibold">Execução não concluída por falta de dados ou dependência.</p>
          <p className="mt-1">{(run.blockReason && BLOCK_REASON_TEXT[run.blockReason]) ?? run.blockReason ?? 'Dependência em falta.'}</p>
        </section>
      ) : null}

      {run.status === 'FAILED' ? (
        <section role="alert" className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-neg-bg)] p-4 text-sm text-[var(--fa-neg)]">
          {run.errorMessage ?? 'A análise falhou.'}
        </section>
      ) : null}

      {run.status === 'RUNNING' ? <p className="text-sm text-[var(--fa-muted)]">Execução em curso. Atualize a página para ver o resultado final.</p> : null}

      {run.agentKey === 'giro-ads' && raw ? <AdsSection result={raw as AdsRunResult} /> : null}
      {run.agentKey === 'central-farma' && raw ? <GestorSection result={raw as GestorRunResult} /> : null}
      {run.agentKey === 'dose-certa' && raw ? <MargemSection result={raw as AgentResult} /> : null}

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

function Findings({ items }: { items: AgentResult['findings'] }) {
  return (
    <section aria-labelledby="findings-title" className="space-y-3">
      <h2 id="findings-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Achados</h2>
      {items.length === 0 ? <p className="text-sm text-[var(--fa-muted)]">Nenhum achado.</p> : null}
      {items.map((finding) => (
        <div key={finding.id} className="rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--fa-muted)]">{SEVERITY_LABEL[finding.severity]}</p>
          <p className="mt-1 font-semibold text-[var(--fa-navy)]">{finding.title}</p>
          <p className="mt-1 text-sm text-[var(--fa-muted)]">{finding.detail}</p>
        </div>
      ))}
    </section>
  );
}

function Recommendations({ items }: { items: AgentResult['recommendations'] }) {
  return (
    <section aria-labelledby="recs-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
      <h2 id="recs-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Recomendações (para decisão humana)</h2>
      {items.length === 0 ? (
        <p className="mt-2 text-sm text-[var(--fa-muted)]">Nenhuma recomendação: não há achados que a exijam.</p>
      ) : (
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--fa-navy)]">
          {items.map((rec) => (
            <li key={rec.text}>{rec.text}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Caveats({ items }: { items: string[] }) {
  return (
    <div className="space-y-1 text-xs text-[var(--fa-muted)]">
      {items.map((caveat) => (
        <p key={caveat}>{caveat}</p>
      ))}
    </div>
  );
}

function MargemSection({ result }: { result: AgentResult }) {
  if (result.status !== 'COMPLETED' || !result.summary) return null;
  return (
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
      <Findings items={result.findings} />
      <Recommendations items={result.recommendations} />
      <section className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 className="text-[13px] font-extrabold text-[var(--fa-navy)]">Origem dos dados</h2>
        <ul className="mt-2 space-y-1 text-sm text-[var(--fa-navy)]">
          {result.sources.map((s) => (
            <li key={s.name}>
              <span className="font-mono text-xs">{s.name}</span> — {s.description}: <strong>{s.count}</strong>
            </li>
          ))}
        </ul>
        <div className="mt-4"><Caveats items={result.caveats} /></div>
      </section>
    </>
  );
}

function AdsSection({ result }: { result: AdsRunResult }) {
  if (result.status !== 'COMPLETED') return null;
  return (
    <>
      <section aria-labelledby="ads-metrics" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 id="ads-metrics" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Publicidade (ADS)</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-4">
          <Metric label="Investimento importado" value={displayMetric(result.metrics.investimento, ' BRL')} />
          <Metric label="Receita atribuída" value={displayMetric(result.metrics.receitaAtribuida)} />
          <Metric label="ROAS" value={displayMetric(result.metrics.roas)} />
          <Metric label="ACOS" value={displayMetric(result.metrics.acos, '%')} />
        </dl>
        <p className="mt-3 text-sm text-[var(--fa-muted)]">{result.metrics.motivoRoasAcos}</p>
        <p className="mt-2 text-xs text-[var(--fa-muted)]">
          Período: {displayPeriod(result.period.inicio, result.period.fim)} · Origem: {result.origem.fonte} · {result.origem.linhasImportadas} linha(s) em {result.origem.ficheirosImportados} ficheiro(s)
        </p>
        <p className="mt-1 text-xs text-[var(--fa-muted)]">
          Análise de margem: {result.analista.status === 'COMPLETED' ? `cruzada com o Analista de ${result.analista.runAt}` : `não cruzada (Analista: ${result.analista.status})`}
        </p>
      </section>
      <Findings items={result.findings} />
      <Recommendations items={result.recommendations} />
      <section className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <Caveats items={result.caveats} />
      </section>
    </>
  );
}

function GestorSection({ result }: { result: GestorRunResult }) {
  const mesa = result.consolidation.mesa;
  return (
    <>
      <section aria-labelledby="mesa-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 id="mesa-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Mesa de reunião</h2>
        <p className="mt-1 text-xs text-[var(--fa-muted)]">{result.consolidation.papelGestor}</p>
        <ul className="mt-4 divide-y divide-[var(--fa-border)]">
          {mesa.agentes.map((a) => (
            <li key={a.agentKey} className="flex flex-wrap items-center justify-between gap-2 py-3">
              <div>
                <p className="font-semibold text-[var(--fa-navy)]">{a.publicName} <span className="font-normal text-[var(--fa-muted)]">(interno: {a.internalName})</span></p>
                <p className="text-xs text-[var(--fa-muted)]">
                  {a.dataExecucao ? `Última execução: ${when(a.dataExecucao)}` : 'Sem execução registada'}
                  {a.motivo ? ` · ${a.motivo}` : ''}
                </p>
                {a.achadosPrincipais.length > 0 ? (
                  <ul className="mt-1 list-disc pl-5 text-xs text-[var(--fa-navy)]">
                    {a.achadosPrincipais.map((t) => <li key={t}>{t}</li>)}
                  </ul>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                <StatusBadge status={ESTADO_BADGE[a.estado]} />
                <span className="sr-only">{ESTADO_TEXTO[a.estado]}</span>
                {a.execucaoId ? <Link href={`/escritorio/execucoes/${a.execucaoId}`} className="text-xs font-semibold text-[var(--fa-orange-700)]">ver execução →</Link> : null}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="prio-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 id="prio-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Prioridades</h2>
        {mesa.prioridades.length === 0 ? <p className="mt-2 text-sm text-[var(--fa-muted)]">Nenhuma prioridade: nenhum agente concluiu com achados.</p> : null}
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-[var(--fa-navy)]">
          {mesa.prioridades.map((p) => (
            <li key={`${p.agente}-${p.titulo}`}>
              <span className="font-semibold">{SEVERITY_LABEL[p.severidade]}</span> · {p.agente}: {p.titulo}
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="pend-title" className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 id="pend-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Pendências de dados</h2>
        {mesa.pendencias.length === 0 ? <p className="mt-2 text-sm text-[var(--fa-muted)]">Nenhuma pendência registada.</p> : null}
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-[var(--fa-navy)]">
          {mesa.pendencias.map((p) => (
            <li key={`${p.agente}-${p.titulo}`}>{p.agente}: {p.titulo}</li>
          ))}
        </ul>
      </section>

      <Recommendations items={mesa.recomendacoes.map((r) => ({ text: `${r.agente}: ${r.texto}`, basedOn: [] }))} />

      <section className="rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5">
        <h2 className="text-[13px] font-extrabold text-[var(--fa-navy)]">Origem das análises</h2>
        <ul className="mt-2 space-y-1 text-sm text-[var(--fa-navy)]">
          {result.sources.map((s) => (
            <li key={s.name}>
              <span className="font-mono text-xs">{s.name}</span> — {s.description}
            </li>
          ))}
        </ul>
        <div className="mt-4"><Caveats items={result.caveats} /></div>
      </section>
    </>
  );
}
