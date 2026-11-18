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
      className="block rounded-xl border p-6 transition-colors hover:bg-accent"
      aria-label="Abrir margem por SKU"
    >
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-emerald-700">📈 Margem por SKU</p>
        <span className="text-xs text-muted-foreground">ver detalhe →</span>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-xs text-muted-foreground">SKUs abaixo do limite</p>
          <p className="mt-1 text-2xl font-semibold text-amber-700">{belowLimit ?? '—'}</p>
        </div>
        <div>
          <p className="text-xs text-muted-foreground">Margem média</p>
          <p className="mt-1 text-2xl font-semibold">{avg === null ? 'Indisponível' : `${avg}%`}</p>
        </div>
      </div>
    </a>
  );
}
