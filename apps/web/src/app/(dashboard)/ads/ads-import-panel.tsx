'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ADS_MAX_ROWS, formatBrl, formatDateBr, percentOf, validateCsvFile } from '@/lib/ads-upload';

// Importação de CSV de investimento publicitário. Fluxo: escolher ficheiro → pré-visualizar (sem gravar)
// → confirmar. O ficheiro fica só na memória desta página; é enviado apenas à própria API.

interface OverlapMatch {
  newLine: number;
  existingLine: number;
  existingBatch: string;
  day: string;
  sku: string | null;
  campaign: string | null;
  amount: string;
}

interface Preview {
  valid: boolean;
  errors: string[];
  warnings: string[];
  requiresConfirmation?: boolean;
  alreadyImported?: boolean;
  overlap?: null | { count: number; amount: string; matches: OverlapMatch[]; sampleSize: number };
  summary: null | {
    rows: number;
    firstDay: string | null;
    lastDay: string | null;
    total: string;
    unallocated: string;
    bySku: Array<{ sku: string; amount: string }>;
    byCampaign: Array<{ campaign: string; amount: string }>;
  };
}
interface ImportResult {
  received: number;
  imported: number;
  skipped: number;
}
type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; message: string };

export function AdsImportPanel({ accountId, accountLabel }: { accountId: string; accountLabel: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [phase, setPhase] = useState<'idle' | 'previewing' | 'importing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  // Confirmação explícita de sobreposição (obrigatória quando a pré-visualização a identifica).
  const [overlapAck, setOverlapAck] = useState(false);
  // Remonta o campo de ficheiro ao limpar a seleção: senão o navegador não dispara "change"
  // ao escolher o mesmo ficheiro outra vez (ex.: reimportação), e o botão ficaria desativado.
  const [inputKey, setInputKey] = useState(0);

  function pick(next: File | null) {
    setResult(null);
    setPreview(null);
    setOverlapAck(false);
    setError(null);
    setFile(next);
    setFileError(next ? validateCsvFile(next) : null);
  }

  async function send<T>(path: string, extra = ''): Promise<ApiEnvelope<T>> {
    const body = new FormData();
    body.append('file', file as File);
    const response = await fetch(`${path}?account_id=${encodeURIComponent(accountId)}${extra}`, { method: 'POST', body });
    const json = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
    return json ?? { ok: false, message: 'Resposta inválida do servidor.' };
  }

  async function previewFile() {
    if (!file || fileError) return;
    setPhase('previewing');
    setError(null);
    setPreview(null);
    const r = await send<Preview>('/api/ads/import/preview');
    setPhase('idle');
    if (!r.ok) return setError(r.message);
    setPreview(r.data);
  }

  async function confirmImport() {
    if (!file || !preview?.valid) return;
    if (preview.requiresConfirmation && !overlapAck) return;
    setPhase('importing');
    setError(null);
    const r = await send<ImportResult>('/api/ads/import', preview.requiresConfirmation ? '&confirm_overlap=true' : '');
    setPhase('idle');
    if (!r.ok) return setError(r.message);
    setResult(r.data);
    setPreview(null);
    setFile(null);
    setOverlapAck(false);
    setInputKey((k) => k + 1);
    router.refresh();
  }

  return (
    <section aria-labelledby="import-title" className="space-y-4 rounded-[var(--fa-r-xl)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-5 shadow-[var(--fa-sh-1)]">
      <div>
        <h2 id="import-title" className="text-[13px] font-extrabold text-[var(--fa-navy)]">Importar investimento publicitário</h2>
        <p className="mt-1 text-xs text-[var(--fa-muted)]">
          Conta: <strong>{accountLabel}</strong>. Os dados são gravados só depois da confirmação.
        </p>
      </div>

      <div className="rounded-[var(--fa-r-md)] bg-[var(--fa-bg)] p-3 text-xs text-[var(--fa-navy)]">
        <p className="font-semibold">Formato do ficheiro CSV</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-5">
          <li><strong>Obrigatórias:</strong> <code>data</code> (AAAA-MM-DD ou DD/MM/AAAA) e <code>valor</code> (1234,56 ou 1234.56).</li>
          <li><strong>Opcionais:</strong> <code>sku</code> e <code>campanha</code>. Sem SKU, o gasto fica como não alocado.</li>
          <li>Delimitador <code>;</code> ou <code>,</code> (detetado pelo cabeçalho). Campos com espaço ou delimitador devem estar entre aspas.</li>
          <li>Limites: 2 MB e {ADS_MAX_ROWS.toLocaleString('pt-BR')} linhas. Um erro em qualquer linha rejeita o ficheiro inteiro.</li>
          <li>Não há suporte a campos com quebra de linha. Reimportar o mesmo ficheiro não duplica.</li>
        </ul>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs font-semibold text-[var(--fa-muted)]">
          Ficheiro CSV
          <input
            key={inputKey}
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => pick(event.target.files?.[0] ?? null)}
            className="text-sm text-[var(--fa-navy)]"
            aria-describedby={fileError ? 'file-error' : undefined}
          />
        </label>
        <button
          type="button"
          onClick={previewFile}
          disabled={!file || !!fileError || phase !== 'idle'}
          className="rounded-[var(--fa-r-md)] bg-[var(--fa-navy)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
        >
          {phase === 'previewing' ? 'A validar…' : 'Pré-visualizar'}
        </button>
      </div>
      {fileError ? <p id="file-error" role="alert" className="text-sm text-[var(--fa-neg)]">{fileError}</p> : null}
      {error ? <p role="alert" className="text-sm text-[var(--fa-neg)]">{error}</p> : null}

      {preview && !preview.valid ? (
        <div role="alert" className="rounded-[var(--fa-r-md)] border border-[var(--fa-border)] bg-[var(--fa-neg-bg)] p-3 text-sm text-[var(--fa-neg)]">
          <p className="font-semibold">Ficheiro rejeitado: {preview.errors.length} erro(s). Nada foi gravado.</p>
          <ul className="mt-2 max-h-60 list-disc space-y-0.5 overflow-auto pl-5 text-xs">
            {preview.errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        </div>
      ) : null}

      {preview && preview.valid && preview.summary ? (
        <div className="space-y-3">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Metric label="Linhas válidas" value={String(preview.summary.rows)} />
            <Metric label="Período" value={preview.summary.firstDay ? `${formatDateBr(preview.summary.firstDay)} a ${formatDateBr(preview.summary.lastDay)}` : '—'} />
            <Metric label="Investimento total" value={formatBrl(preview.summary.total)} />
            <Metric label="Sem SKU" value={`${formatBrl(preview.summary.unallocated)} (${percentOf(preview.summary.unallocated, preview.summary.total)})`} />
          </dl>
          {preview.warnings.map((w) => (
            <p key={w} role="status" className="rounded-[var(--fa-r-md)] bg-[var(--fa-warn-bg)] p-3 text-sm text-[var(--fa-navy)]">{w}</p>
          ))}
          {preview.overlap && preview.overlap.count > 0 ? (
            <div className="space-y-2 rounded-[var(--fa-r-md)] border border-[var(--fa-orange-700)] p-3">
              <p className="text-sm font-semibold text-[var(--fa-navy)]">
                Possível duplicação: {preview.overlap.count} linha(s), {formatBrl(preview.overlap.amount)}, já existem de outro ficheiro.
              </p>
              <p className="text-xs text-[var(--fa-muted)]">
                Nada será apagado automaticamente: despesas legítimas podem ter valores iguais. Se estas linhas forem a mesma despesa re-exportada, importar duplicaria o investimento.
              </p>
              <div className="max-h-56 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="text-left text-[var(--fa-muted)]">
                    <tr><th className="py-1">Linha nova</th><th>Linha existente</th><th>Lote</th><th>Dia</th><th>SKU</th><th>Campanha</th><th className="text-right">Valor</th></tr>
                  </thead>
                  <tbody>
                    {preview.overlap.matches.map((m) => (
                      <tr key={`${m.newLine}-${m.existingLine}-${m.existingBatch}`} className="border-t border-[var(--fa-border)]">
                        <td className="py-1">{m.newLine}</td>
                        <td>{m.existingLine}</td>
                        <td className="font-mono">{m.existingBatch}</td>
                        <td>{formatDateBr(m.day)}</td>
                        <td>{m.sku ?? '—'}</td>
                        <td>{m.campaign ?? '—'}</td>
                        <td className="fa-num text-right">{formatBrl(m.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.overlap.count > preview.overlap.matches.length ? (
                <p className="text-xs text-[var(--fa-muted)]">Mostrando {preview.overlap.matches.length} de {preview.overlap.count}.</p>
              ) : null}
              <label className="flex items-start gap-2 text-sm text-[var(--fa-navy)]">
                <input type="checkbox" checked={overlapAck} onChange={(e) => setOverlapAck(e.target.checked)} className="mt-1" />
                Confirmo que estas linhas são despesas distintas e não repetidas, e quero importar o ficheiro mesmo assim. Esta confirmação fica registada.
              </label>
            </div>
          ) : null}
          <button
            type="button"
            onClick={confirmImport}
            disabled={phase !== 'idle' || (!!preview.requiresConfirmation && !overlapAck)}
            className="rounded-[var(--fa-r-md)] bg-[var(--fa-orange-700)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            {phase === 'importing' ? 'A importar…' : `Confirmar importação de ${preview.summary.rows} linha(s)`}
          </button>
        </div>
      ) : null}

      {result ? (
        <p role="status" className="rounded-[var(--fa-r-md)] bg-[var(--fa-ok-bg)] p-3 text-sm text-[var(--fa-navy)]">
          Importação concluída: {result.imported} linha(s) nova(s), {result.skipped} ignorada(s) por já existirem, de {result.received} recebida(s). Os indicadores foram atualizados.
        </p>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-[var(--fa-muted)]">{label}</dt>
      <dd className="fa-num mt-1 text-base font-extrabold text-[var(--fa-navy)]">{value}</dd>
    </div>
  );
}
