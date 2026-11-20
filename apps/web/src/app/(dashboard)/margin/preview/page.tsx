import { fetchApi } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import RuleForm from './rule-form';

// Gestor de Margem (WeStack) — página só leitura. Margem líquida = receita − taxas ML − CMV.
// Nunca estima nem altera o Mercado Livre; SKUs sem custo/taxa aparecem como "Indisponível".

interface MarginLine {
  key: string;
  sku: string | null;
  description: string | null;
  date: string | null;
  status: 'disponivel' | 'indisponivel';
  reason?: string;
  revenue: string;
  fees: string | null;
  cost: string | null;
  margin: string | null;
  marginPercent: string | null;
  itemsCount: number;
  costStatus: string;
}
interface MarginPreview {
  group_by: string;
  lines: MarginLine[];
  totals: { revenue: string; groupsAvailable: number; groupsUnavailable: number };
}
interface MarginRanking {
  heroes: MarginLine[];
  villains: MarginLine[];
  unavailableCount: number;
}
interface MarginRule {
  id: string;
  sku: string | null;
  minMarginPercent: string | null;
  minMarginAmount: string | null;
}
interface MarginAlert {
  sku: string | null;
  description: string | null;
  margin: string | null;
  marginPercent: string | null;
  limitPercent: string | null;
  limitAmount: string | null;
  recommendation: string;
}

const brl = (v: string | null) =>
  v === null ? 'Indisponível' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (v: string | null) => (v === null ? '—' : `${Number(v).toFixed(1)}%`);

function averageMargin(lines: MarginLine[]): string | null {
  const available = lines.filter((l) => l.status === 'disponivel' && l.marginPercent !== null);
  if (available.length === 0) return null;
  const sum = available.reduce((s, l) => s + Number(l.marginPercent), 0);
  return (sum / available.length).toFixed(1);
}

function RankingList({ title, empty, lines }: { title: string; empty: string; lines: MarginLine[] }) {
  return (
    <div className="rounded-xl border p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="mt-3 space-y-2 text-sm">
          {lines.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-4">
              <span className="truncate">
                <strong>{l.sku ?? '(sem SKU)'}</strong>
                <span className="text-muted-foreground"> {l.description ? `— ${l.description}` : ''}</span>
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{pct(l.marginPercent)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default async function MarginPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ account_id?: string; start_date?: string; end_date?: string }>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams({ group_by: 'sku' });
  if (params.account_id) query.set('account_id', params.account_id);
  if (params.start_date) query.set('start_date', params.start_date);
  if (params.end_date) query.set('end_date', params.end_date);
  const accountQuery = new URLSearchParams();
  if (params.account_id) accountQuery.set('account_id', params.account_id);
  if (params.start_date) accountQuery.set('start_date', params.start_date);
  if (params.end_date) accountQuery.set('end_date', params.end_date);

  const [{ data: preview }, { data: alerts }, { data: ranking }, { data: rules }, user] = await Promise.all([
    fetchApi<MarginPreview>(`/margin/preview?${query}`),
    fetchApi<MarginAlert[]>(`/margin/alerts?${accountQuery}`),
    fetchApi<MarginRanking>(`/margin/ranking?${accountQuery}`),
    fetchApi<MarginRule[]>('/margin/rules'),
    getCurrentUser(),
  ]);
  const isAdmin = user?.role === 'ADMIN';

  const avg = averageMargin(preview.lines);

  return (
    <article className="mx-auto max-w-5xl space-y-8">
      <header className="border-b pb-6">
        <p className="text-xs uppercase tracking-widest text-emerald-700">Farmaecon · WeStack / Margem por SKU</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Margem líquida por SKU</h1>
        <p className="mt-3 text-muted-foreground">
          Receita − taxas do Mercado Livre − CMV publicado. Indicativo e só leitura: nenhuma alteração é feita no Mercado Livre.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">SKUs abaixo do limite</p>
          <p className="mt-3 text-3xl font-semibold text-amber-700">{alerts.length}</p>
        </div>
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Margem média (disponível)</p>
          <p className="mt-3 text-3xl font-semibold">{avg === null ? 'Indisponível' : `${avg}%`}</p>
        </div>
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">SKUs com margem confirmável</p>
          <p className="mt-3 text-3xl font-semibold">
            {preview.totals.groupsAvailable}
            <span className="text-base font-normal text-muted-foreground">
              {' '}
              / {preview.totals.groupsAvailable + preview.totals.groupsUnavailable}
            </span>
          </p>
        </div>
      </div>

      {alerts.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
          <h2 className="text-xl font-semibold">SKUs abaixo do limite configurado</h2>
          <ul className="mt-3 space-y-2">
            {alerts.map((a) => (
              <li key={a.sku ?? '(sem sku)'} className="text-sm">
                <strong>{a.sku ?? '(sem SKU)'}</strong> — margem {pct(a.marginPercent)}
                {a.limitPercent !== null && <> (limite {pct(a.limitPercent)})</>}. {a.recommendation}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <RankingList title="Melhores margens" empty="Nenhum SKU com margem positiva confirmável." lines={ranking.heroes} />
        <RankingList title="Piores margens" empty="Nenhum SKU com margem confirmável abaixo do restante." lines={ranking.villains} />
        {ranking.unavailableCount > 0 && (
          <p className="text-sm text-muted-foreground md:col-span-2">
            {ranking.unavailableCount} SKU(s) fora do ranking por falta de custo aprovado ou taxa ML.
          </p>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-xl font-semibold">Detalhe por SKU</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b">
              <tr>
                {['SKU', 'Descrição', 'Receita', 'Taxas ML', 'CMV', 'Margem', 'Margem %', 'Estado'].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((l) => (
                <tr key={l.key} className="border-b">
                  <td className="p-3 font-medium">{l.sku ?? '(sem SKU)'}</td>
                  <td className="p-3 text-muted-foreground">{l.description ?? '—'}</td>
                  <td className="p-3">{brl(l.revenue)}</td>
                  <td className="p-3">{brl(l.fees)}</td>
                  <td className="p-3">{brl(l.cost)}</td>
                  <td className="p-3">{brl(l.margin)}</td>
                  <td className="p-3">{pct(l.marginPercent)}</td>
                  <td className="p-3">
                    {l.status === 'disponivel' ? (
                      <span className="text-emerald-700">Disponível</span>
                    ) : (
                      <span className="text-amber-700" title={l.reason}>
                        Indisponível
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.lines.length === 0 && <p className="p-4 text-muted-foreground">Nenhuma venda no período para esta empresa.</p>}
      </section>

      <section className="space-y-4 rounded-xl border p-6">
        <h2 className="text-xl font-semibold">Regras de margem</h2>
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma regra definida. Sem regra, nenhum SKU gera alerta.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {rules.map((r) => (
              <li key={r.id}>
                <strong>{r.sku ?? 'Global (todos os SKUs)'}</strong> — mínimo {pct(r.minMarginPercent)}
              </li>
            ))}
          </ul>
        )}
        {isAdmin ? (
          <RuleForm />
        ) : (
          <p className="text-sm text-muted-foreground">Apenas administradores podem alterar as regras de margem.</p>
        )}
      </section>

      <section className="rounded-xl border border-amber-300 bg-amber-50 p-6 text-amber-950">
        <h2 className="text-xl font-semibold">Limites desta prévia</h2>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          <li>A margem só é calculada quando há taxa do Mercado Livre e custo APROVADO para o SKU; caso contrário fica Indisponível.</li>
          <li>O CMV usa o custo publicado mais recente antes da venda; custos estimados ou ausentes não entram no cálculo.</li>
          <li>Os alertas são informativos. Nenhum preço, anúncio ou estoque é alterado no Mercado Livre.</li>
        </ul>
      </section>
    </article>
  );
}
