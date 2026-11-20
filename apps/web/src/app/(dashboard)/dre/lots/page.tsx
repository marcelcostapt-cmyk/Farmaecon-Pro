import { fetchApi } from '@/lib/api';

// Lotes com validade vencida ou a vencer (só leitura). Dados vêm da NF-e importada; nada é alterado.

interface ExpiringLot {
  itemId: string;
  invoiceId: string;
  invoiceFilename: string;
  invoiceStatus: string;
  ean: string | null;
  description: string | null;
  lotNumber: string | null;
  quantity: string | null;
  expiryDate: string; // AAAA-MM-DD
  daysToExpiry: number;
  status: 'vencido' | 'a_vencer';
}

const WINDOWS = [30, 90, 180] as const;
type Window = (typeof WINDOWS)[number];

const brDate = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const dueText = (days: number) => {
  if (days < 0) return `${-days} dia(s) vencido`;
  if (days === 0) return 'vence hoje';
  return `em ${days} dia(s)`;
};

export default async function DreLotsPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const params = await searchParams;
  const days: Window = WINDOWS.find((w) => String(w) === params.days) ?? 90;
  const { data: lots } = await fetchApi<ExpiringLot[]>(`/dre/lots/expiring?days=${days}`);

  const expired = lots.filter((l) => l.status === 'vencido').length;

  return (
    <article className="mx-auto max-w-5xl space-y-8">
      <header className="border-b pb-6">
        <p className="text-xs uppercase tracking-widest text-emerald-700">Farmaecon · Lotes</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Lotes e validades</h1>
        <p className="mt-3 text-muted-foreground">
          Lotes das notas fiscais de compra vencidos ou a vencer. Só leitura: nenhum custo ou preço é alterado.
        </p>
      </header>

      <nav className="flex gap-2 text-sm" aria-label="Janela de validade">
        {WINDOWS.map((w) => (
          <a
            key={w}
            href={`/dre/lots?days=${w}`}
            aria-current={w === days ? 'page' : undefined}
            className={`rounded-md border px-3 py-1.5 ${w === days ? 'bg-emerald-700 text-white' : 'hover:bg-muted'}`}
          >
            Próximos {w} dias
          </a>
        ))}
      </nav>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Lotes na janela</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{lots.length}</p>
        </div>
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Já vencidos</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-red-700">{expired}</p>
        </div>
      </div>

      <section>
        {lots.length === 0 ? (
          <p className="p-4 text-muted-foreground">Nenhum lote vencido ou a vencer nesta janela.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  {['Situação', 'Validade', 'Prazo', 'Lote', 'EAN', 'Descrição', 'Quantidade', 'Nota fiscal'].map((h) => (
                    <th key={h} className="p-3">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.itemId} className="border-b">
                    <td className="p-3">
                      {l.status === 'vencido' ? (
                        <span className="font-semibold text-red-700">Vencido</span>
                      ) : (
                        <span className="text-amber-700">A vencer</span>
                      )}
                    </td>
                    <td className="p-3 tabular-nums">{brDate(l.expiryDate)}</td>
                    <td className="p-3">{dueText(l.daysToExpiry)}</td>
                    <td className="p-3 font-medium">{l.lotNumber ?? '—'}</td>
                    <td className="p-3">{l.ean ?? '—'}</td>
                    <td className="p-3 text-muted-foreground">{l.description ?? '—'}</td>
                    <td className="p-3 tabular-nums">{l.quantity ?? '—'}</td>
                    <td className="p-3">
                      {l.invoiceFilename}
                      <span className="block text-xs text-muted-foreground">
                        {l.invoiceStatus === 'APPROVED' ? 'Aprovada' : 'Pendente de revisão'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </article>
  );
}
