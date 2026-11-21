'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProxyResult } from '@/app/api/integrations/api-bridge';

const DECIMAL = /^\d+(\.\d+)?$/;

async function saveRule(body: { sku: string | null; minMarginPercent: string }): Promise<ProxyResult> {
  try {
    const response = await fetch('/api/margin/rules', {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as ProxyResult | null;
    return result ?? { ok: false, message: 'Resposta inválida do servidor.' };
  } catch {
    return { ok: false, message: 'Sem ligação ao servidor. Tente novamente.' };
  }
}

/** Define o limite mínimo de margem (%) de um SKU, ou o global quando o SKU fica vazio. Só ADMIN (a API valida). */
export default function RuleForm() {
  const router = useRouter();
  const [sku, setSku] = useState('');
  const [percent, setPercent] = useState('');
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!DECIMAL.test(percent)) {
      setMessage({ kind: 'error', text: 'Informe um percentual válido, por exemplo 40.' });
      return;
    }
    startTransition(async () => {
      const result = await saveRule({ sku: sku.trim() || null, minMarginPercent: percent });
      if (result.ok) {
        setMessage({ kind: 'ok', text: 'Regra guardada.' });
        setSku('');
        setPercent('');
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: result.message });
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="grid gap-1 text-sm">
        <span>SKU (vazio = regra global)</span>
        <input
          value={sku}
          onChange={(e) => setSku(e.target.value)}
          maxLength={120}
          className="rounded-md border bg-background px-3 py-2"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Margem mínima (%)</span>
        <input
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          inputMode="decimal"
          placeholder="40"
          required
          className="rounded-md border bg-background px-3 py-2"
        />
      </label>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {isPending ? 'A guardar…' : 'Guardar regra'}
      </button>
      {message && (
        <p role="status" className={`sm:col-span-3 text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}
    </form>
  );
}
