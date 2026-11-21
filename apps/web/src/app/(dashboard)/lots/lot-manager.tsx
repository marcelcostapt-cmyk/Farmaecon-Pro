'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProxyResult } from '@/app/api/integrations/api-bridge';
import { LOT_STATUS_LABEL, STATUS_CLASS, type LotView } from './types';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

type Draft = {
  productName: string;
  ean: string;
  sku: string;
  lotNumber: string;
  fabricationDate: string;
  expiryDate: string;
  notes: string;
};

const EMPTY: Draft = { productName: '', ean: '', sku: '', lotNumber: '', fabricationDate: '', expiryDate: '', notes: '' };

const fromLot = (l: LotView): Draft => ({
  productName: l.productName,
  ean: l.ean ?? '',
  sku: l.sku ?? '',
  lotNumber: l.lotNumber,
  fabricationDate: l.fabricationDate ?? '',
  expiryDate: l.expiryDate ?? '',
  notes: l.notes ?? '',
});

/** Campos vazios viram null; datas só são enviadas se estiverem em AAAA-MM-DD. */
function toBody(d: Draft): { ok: true; body: Record<string, string | null> } | { ok: false; message: string } {
  if (d.productName.trim() === '' || d.lotNumber.trim() === '') return { ok: false, message: 'Produto e número do lote são obrigatórios.' };
  for (const [label, value] of [['Fabricação', d.fabricationDate], ['Validade', d.expiryDate]] as const) {
    if (value !== '' && !DAY.test(value)) return { ok: false, message: `${label}: use o formato AAAA-MM-DD.` };
  }
  const opt = (v: string) => (v.trim() === '' ? null : v.trim());
  return {
    ok: true,
    body: {
      productName: d.productName.trim(),
      ean: opt(d.ean),
      sku: opt(d.sku),
      lotNumber: d.lotNumber.trim(),
      fabricationDate: opt(d.fabricationDate),
      expiryDate: opt(d.expiryDate),
      notes: opt(d.notes),
    },
  };
}

async function callApi(path: string, method: 'POST' | 'PATCH', body: unknown): Promise<ProxyResult> {
  try {
    const response = await fetch(path, {
      method,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as ProxyResult | null;
    return result ?? { ok: false, message: 'Resposta inválida do servidor.' };
  } catch {
    return { ok: false, message: 'Sem ligação ao servidor. Tente novamente.' };
  }
}

function Fields({ draft, onChange }: { draft: Draft; onChange: (next: Draft) => void }) {
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...draft, [key]: e.target.value });
  const input = 'rounded-md border bg-background px-2 py-1.5 text-sm';
  return (
    <>
      <label className="grid gap-1 text-xs">
        <span>Produto *</span>
        <input className={input} value={draft.productName} onChange={set('productName')} maxLength={200} />
      </label>
      <label className="grid gap-1 text-xs">
        <span>Lote *</span>
        <input className={input} value={draft.lotNumber} onChange={set('lotNumber')} maxLength={60} />
      </label>
      <label className="grid gap-1 text-xs">
        <span>EAN</span>
        <input className={input} value={draft.ean} onChange={set('ean')} maxLength={60} />
      </label>
      <label className="grid gap-1 text-xs">
        <span>SKU</span>
        <input className={input} value={draft.sku} onChange={set('sku')} maxLength={60} />
      </label>
      <label className="grid gap-1 text-xs">
        <span>Fabricação</span>
        <input type="date" className={input} value={draft.fabricationDate} onChange={set('fabricationDate')} />
      </label>
      <label className="grid gap-1 text-xs">
        <span>Validade</span>
        <input type="date" className={input} value={draft.expiryDate} onChange={set('expiryDate')} />
      </label>
      <label className="grid gap-1 text-xs sm:col-span-2 lg:col-span-4">
        <span>Observações</span>
        <input className={input} value={draft.notes} onChange={set('notes')} maxLength={500} />
      </label>
    </>
  );
}

export default function LotManager({ lots, isAdmin }: { lots: LotView[]; isAdmin: boolean }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(EMPTY);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  function save(path: string, method: 'POST' | 'PATCH', source: Draft, onDone: () => void) {
    const prepared = toBody(source);
    if (!prepared.ok) {
      setMessage({ kind: 'error', text: prepared.message });
      return;
    }
    startTransition(async () => {
      const result = await callApi(path, method, prepared.body);
      if (result.ok) {
        setMessage({ kind: 'ok', text: method === 'POST' ? 'Lote cadastrado.' : 'Lote atualizado.' });
        onDone();
        router.refresh();
      } else {
        setMessage({ kind: 'error', text: result.message });
      }
    });
  }

  return (
    <section className="space-y-4">
      {isAdmin && (
        <div className="rounded-xl border p-4">
          {!creating ? (
            <button type="button" onClick={() => setCreating(true)} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white">
              Cadastrar lote
            </button>
          ) : (
            <form
              className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
              onSubmit={(e) => {
                e.preventDefault();
                save('/api/lots', 'POST', draft, () => {
                  setDraft(EMPTY);
                  setCreating(false);
                });
              }}
            >
              <Fields draft={draft} onChange={setDraft} />
              <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                <button type="submit" disabled={isPending} className="rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-60">
                  {isPending ? 'A guardar…' : 'Guardar lote'}
                </button>
                <button type="button" onClick={() => setCreating(false)} className="rounded-md border px-4 py-2 text-sm">
                  Cancelar
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {message && (
        <p role="status" className={`text-sm ${message.kind === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>
          {message.text}
        </p>
      )}

      {lots.length === 0 ? (
        <p className="p-4 text-muted-foreground">Nenhum lote encontrado com estes filtros.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b">
              <tr>
                {['Situação', 'Validade', 'Prazo', 'Produto', 'Lote', 'EAN / SKU', 'Fabricação', ''].map((h) => (
                  <th key={h} className="p-3">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lots.map((l) => (
                <tr key={l.id} className="border-b align-top">
                  {editingId === l.id ? (
                    <td colSpan={8} className="p-3">
                      <form
                        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
                        onSubmit={(e) => {
                          e.preventDefault();
                          save(`/api/lots/${encodeURIComponent(l.id)}`, 'PATCH', editDraft, () => setEditingId(null));
                        }}
                      >
                        <Fields draft={editDraft} onChange={setEditDraft} />
                        <div className="flex gap-2 sm:col-span-2 lg:col-span-4">
                          <button type="submit" disabled={isPending} className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm text-white disabled:opacity-60">
                            Guardar
                          </button>
                          <button type="button" onClick={() => setEditingId(null)} className="rounded-md border px-3 py-1.5 text-sm">
                            Cancelar
                          </button>
                        </div>
                      </form>
                    </td>
                  ) : (
                    <>
                      <td className="p-3">
                        <span className={`inline-block rounded-md px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[l.status]}`}>
                          {LOT_STATUS_LABEL[l.status]}
                        </span>
                      </td>
                      <td className="p-3 tabular-nums">{l.expiryDate ? brDate(l.expiryDate) : '—'}</td>
                      <td className="p-3">{dueText(l.daysToExpiry)}</td>
                      <td className="p-3">
                        <span className="font-medium">{l.productName}</span>
                        {l.notes && <span className="block text-xs text-muted-foreground">{l.notes}</span>}
                      </td>
                      <td className="p-3 font-medium">{l.lotNumber}</td>
                      <td className="p-3 text-muted-foreground">
                        {l.ean ?? '—'}
                        {l.sku ? ` · ${l.sku}` : ''}
                      </td>
                      <td className="p-3 tabular-nums">{l.fabricationDate ? brDate(l.fabricationDate) : '—'}</td>
                      <td className="p-3">
                        {isAdmin && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditDraft(fromLot(l));
                              setEditingId(l.id);
                              setMessage(null);
                            }}
                            className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                          >
                            Editar
                          </button>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function brDate(iso: string) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function dueText(days: number | null) {
  if (days === null) return '—';
  if (days < 0) return `${-days} dia(s) vencido`;
  if (days === 0) return 'vence hoje';
  return `em ${days} dia(s)`;
}
