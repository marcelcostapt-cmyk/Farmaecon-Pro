import Link from 'next/link';
import { fetchApi } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import LotManager from './lot-manager';
import { LOT_STATUS_LABEL, type LotStatus, type LotView } from './types';

// Gestão de lotes e validades: listagem com estado de validade, filtros e cadastro/edição (ADMIN).

const STATUS_OPTIONS: Array<{ value: '' | LotStatus; label: string }> = [
  { value: '', label: 'Todos os estados' },
  { value: 'vencido', label: LOT_STATUS_LABEL.vencido },
  { value: 'vence_em_30', label: LOT_STATUS_LABEL.vence_em_30 },
  { value: 'vigente', label: LOT_STATUS_LABEL.vigente },
  { value: 'sem_validade', label: LOT_STATUS_LABEL.sem_validade },
];

export default async function LotsPage({ searchParams }: { searchParams: Promise<{ product?: string; status?: string }> }) {
  const params = await searchParams;
  const product = params.product?.trim() ?? '';
  const status = STATUS_OPTIONS.find((o) => o.value !== '' && o.value === params.status)?.value ?? '';

  const query = new URLSearchParams();
  if (product) query.set('product', product);
  if (status) query.set('status', status);

  const [{ data: lots }, user] = await Promise.all([fetchApi<LotView[]>(`/lots?${query}`), getCurrentUser()]);
  const isAdmin = user?.role === 'ADMIN';
  const expired = lots.filter((l) => l.status === 'vencido').length;
  const soon = lots.filter((l) => l.status === 'vence_em_30').length;

  return (
    <article className="mx-auto max-w-6xl space-y-8">
      <header className="border-b pb-6">
        <p className="text-xs uppercase tracking-widest text-emerald-700">Farmaecon · Lotes</p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight">Lotes e validades</h1>
        <p className="mt-3 text-muted-foreground">
          Cadastre os lotes dos produtos e acompanhe o que está vencido ou perto de vencer.{' '}
          <Link href="/dre/lots" className="underline">
            Ver lotes importados das notas fiscais
          </Link>
          .
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Lotes listados</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums">{lots.length}</p>
        </div>
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Vencidos</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-red-700">{expired}</p>
        </div>
        <div className="rounded-xl border p-6">
          <p className="text-sm text-muted-foreground">Vencem em até 30 dias</p>
          <p className="mt-3 text-3xl font-semibold tabular-nums text-amber-700">{soon}</p>
        </div>
      </div>

      <form method="GET" className="flex flex-wrap items-end gap-3 text-sm">
        <label className="grid gap-1">
          <span>Produto, EAN ou SKU</span>
          <input name="product" defaultValue={product} className="rounded-md border bg-background px-3 py-2" />
        </label>
        <label className="grid gap-1">
          <span>Estado</span>
          <select name="status" defaultValue={status} className="rounded-md border bg-background px-3 py-2">
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="rounded-md border px-4 py-2 hover:bg-muted">
          Filtrar
        </button>
        {(product || status) && (
          <Link href="/lots" className="px-2 py-2 text-muted-foreground underline">
            Limpar filtros
          </Link>
        )}
      </form>

      <LotManager lots={lots} isAdmin={isAdmin} />
    </article>
  );
}
