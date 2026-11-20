import { fetchApi } from '@/lib/api';

// Card de resumo da margem (WeStack) para o escritório. Só leitura: liga ao detalhe em /margin/preview.
interface MarginLine { status: 'disponivel' | 'indisponivel'; marginPercent: string | null }
interface MarginPreview { lines: MarginLine[]; totals: { groupsAvailable: number; groupsUnavailable: number } }
interface MarginAlert { sku: string | null }

function averageMargin(lines: MarginLine[]): string | null {
  const available = lines.filter((l) => l.status === 'disponivel' && l.marginPercent !== null);
  if (available.length === 0) return null;
  return (available.reduce((s, l) => s + Number(l.marginPercent), 0) / available.length).toFixed(1);
}

export async function MargemResumoCard() {
  let belowLimit: number | null = null;
  let avg: string | null = null;
  try {
    const [{ data: preview }, { data: alerts }] = await Promise.all([
      fetchApi<MarginPreview>('/margin/preview?group_by=sku'),
      fetchApi<MarginAlert[]>('/margin/alerts'),
    ]);
    belowLimit = alerts.length;
    avg = averageMargin(preview.lines);
  } catch {
    // Mantém o card utilizável mesmo sem dados; o detalhe explica a indisponibilidade.
    belowLimit = null;
  }

  return (
    <a
      href="/margin/preview"
      className="block rounded-[var(--fa-r-lg)] border border-[var(--fa-border)] bg-[var(--fa-surface)] p-6 shadow-[var(--fa-sh-1)] transition-shadow hover:shadow-[var(--fa-sh-2)]"
      aria-label="Abrir margem por SKU"
    >
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-extrabold text-[var(--fa-navy)]">📈 Margem por SKU</p>
        <span className="text-xs font-semibold text-[var(--fa-orange-700)]">ver detalhe →</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-[var(--fa-muted)]">SKUs abaixo do limite</p>
          <p
            className="fa-num mt-1 text-[30px] font-extrabold leading-none"
            style={{ color: belowLimit && belowLimit > 0 ? 'var(--fa-neg)' : 'var(--fa-navy)' }}
          >
            {belowLimit ?? '—'}
          </p>
        </div>
        <div>
          <p className="text-xs text-[var(--fa-muted)]">Margem média</p>
          <p className="fa-num mt-1 text-[30px] font-extrabold leading-none text-[var(--fa-navy)]">
            {avg === null ? <span className="text-base font-semibold text-[var(--fa-muted-2)]">Indisponível</span> : `${avg}%`}
          </p>
        </div>
      </div>
    </a>
  );
}
