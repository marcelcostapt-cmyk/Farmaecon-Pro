import { fetchApi } from '@/lib/api';

// Card de resumo de lotes e validades para o escritório. Só leitura: liga à gestão em /lots.
interface LotView { status: 'vencido' | 'vence_em_30' | 'vigente' | 'sem_validade' }

export async function LotesResumoCard() {
  let total: number | null = null;
  let expired = 0;
  let soon = 0;
  try {
    const { data: lots } = await fetchApi<LotView[]>('/lots');
    total = lots.length;
    expired = lots.filter((l) => l.status === 'vencido').length;
    soon = lots.filter((l) => l.status === 'vence_em_30').length;
  } catch {
    // Card utilizável mesmo sem dados.
    total = null;
  }

  return (
    <a
      href="/lots"
      className="block rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-6 shadow-[var(--fa-sh-1)] transition-shadow hover:shadow-[var(--fa-sh-2)]"
      aria-label="Abrir lotes e validades"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-extrabold text-[var(--fa-navy)]">🧾 Lotes e validades</p>
        <span className="text-xs font-semibold text-[var(--fa-orange-700)]">ver lotes →</span>
      </div>
      <div className="mt-4 grid grid-cols-3 gap-4">
        <div>
          <p className="text-xs text-[var(--fa-muted)]">Lotes</p>
          <p className="mt-1 text-[30px] font-extrabold tabular-nums text-[var(--fa-navy)]">{total ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-[var(--fa-muted)]">Vencidos</p>
          <p className={`mt-1 text-[30px] font-extrabold tabular-nums ${expired > 0 ? 'text-[var(--fa-neg)]' : 'text-[var(--fa-navy)]'}`}>
            {total === null ? '—' : expired}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--fa-muted)]">Vencem em 30 dias</p>
          <p className="mt-1 text-[30px] font-extrabold tabular-nums text-[var(--fa-navy)]">{total === null ? '—' : soon}</p>
        </div>
      </div>
    </a>
  );
}
