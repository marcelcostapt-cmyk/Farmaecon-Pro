'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

// Executa o agente ADS (Giro Ads) para a conta escolhida. Só leitura; o resultado fica registado.
export function RunAdsButton({ accountId }: { accountId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/agents/giro-ads/runs', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId }),
      });
      const result = (await response.json().catch(() => null)) as { ok: boolean; data?: { id: string }; message?: string } | null;
      if (!result?.ok || !result.data) return setError(result?.message ?? 'Não foi possível executar a análise.');
      router.push(`/escritorio/execucoes/${result.data.id}`);
    } catch {
      setError('Sem ligação ao servidor. Tente novamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={run} disabled={pending} className="rounded-[var(--fa-r-md)] border border-[var(--fa-navy)] px-4 py-2 text-sm font-semibold text-[var(--fa-navy)] disabled:opacity-60">
        {pending ? 'A analisar…' : 'Executar análise do ADS'}
      </button>
      {error ? <p role="alert" className="text-sm text-[var(--fa-neg)]">{error}</p> : null}
    </div>
  );
}
