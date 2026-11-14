'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProxyResult } from '@/app/api/integrations/api-bridge';
import type { Account } from './types';

type Action = 'rename' | 'sync' | 'disconnect' | 'reconnect' | 'remove';

const PLATFORMS: Record<string, { label: string; color: string; icon: string }> = {
  MERCADO_LIVRE: { label: 'Mercado Livre', color: 'border-yellow-400/30 bg-yellow-400/5', icon: '🛒' },
  AMAZON: { label: 'Amazon', color: 'border-orange-400/30 bg-orange-400/5', icon: '📦' },
  SHOPEE: { label: 'Shopee', color: 'border-red-400/30 bg-red-400/5', icon: '🛍️' },
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  ACTIVE: { label: 'Ativa', className: 'bg-green-500/15 text-green-700' },
  WARNING: { label: 'Atenção', className: 'bg-yellow-400/20 text-yellow-800' },
  DISCONNECTED: { label: 'Desconectada', className: 'bg-muted text-muted-foreground' },
  SYNCING: { label: 'Sincronizando…', className: 'bg-blue-500/15 text-blue-700' },
};

const CONFIRM = {
  disconnect: 'Desconectar esta conta? A sincronização para e os tokens são apagados.',
  remove: 'Remover esta conta da lista? Esta ação não pode ser desfeita.',
};

// Fixed time zone so server render and hydration print the same text.
const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const formatDate = (value: string | null) => (value ? dateFormat.format(new Date(value)) : null);

async function callApi<T = unknown>(path: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown): Promise<ProxyResult<T>> {
  try {
    const response = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as ProxyResult<T> | null;
    return result ?? { ok: false, message: 'Resposta inválida do servidor.' };
  } catch {
    return { ok: false, message: 'Sem ligação ao servidor. Tente novamente.' };
  }
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M11.5 2.5l2 2L6 12l-3 1 1-3 7.5-7.5z" strokeLinejoin="round" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 2a6 6 0 1 0 6 6" strokeLinecap="round" />
    </svg>
  );
}

export default function AccountCard({ account, isAdmin }: { account: Account; isAdmin: boolean }) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(account.displayName ?? '');
  const skipBlurSave = useRef(false);

  const platform = PLATFORMS[account.platform] ?? { label: account.platform, color: '', icon: '🔌' };
  const disconnected = account.status === 'DISCONNECTED';
  const syncing = !disconnected && (account.syncStatus === 'PARTIAL' || account.syncStatus === 'RUNNING');
  const badge = STATUS_BADGE[syncing ? 'SYNCING' : account.status] ?? STATUS_BADGE.WARNING;
  const busy = pending !== null || isRefreshing;
  const base = `/api/integrations/${encodeURIComponent(account.id)}`;

  async function run<T>(action: Action, request: () => Promise<ProxyResult<T>>, onSuccess?: (data: T) => void) {
    setPending(action);
    setError(null);
    setNotice(null);
    const result = await request();
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    onSuccess?.(result.data);
    startTransition(() => router.refresh());
  }

  function startEditing() {
    setDraft(account.displayName ?? '');
    setEditing(true);
  }

  function saveName() {
    setEditing(false);
    if (draft.trim() === (account.displayName ?? '')) return;
    void run('rename', () => callApi(base, 'PATCH', { displayName: draft }));
  }

  function onNameKey(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault();
      skipBlurSave.current = true;
      saveName();
    } else if (event.key === 'Escape') {
      skipBlurSave.current = true;
      setEditing(false);
    }
  }

  function onNameBlur() {
    if (skipBlurSave.current) {
      skipBlurSave.current = false;
      return;
    }
    saveName();
  }

  const sync = () => run('sync', () => callApi(`${base}/sync`, 'POST'), () => setNotice('Sincronização iniciada. Os pedidos estão a ser importados.'));
  const disconnect = () => {
    if (window.confirm(CONFIRM.disconnect)) void run('disconnect', () => callApi(`${base}/disconnect`, 'POST'));
  };
  const remove = () => {
    if (window.confirm(CONFIRM.remove)) void run('remove', () => callApi(base, 'DELETE'));
  };
  const reconnect = async () => {
    setPending('reconnect');
    setError(null);
    const result = await callApi<{ url: string }>(`${base}/reconnect`, 'POST');
    if (result.ok && result.data?.url) {
      window.location.assign(result.data.url); // keep the button pending while the browser leaves
      return;
    }
    setPending(null);
    setError(result.ok ? 'Não foi possível iniciar a reconexão.' : result.message);
  };

  const label = (action: Action, text: string) => (pending === action ? <><Spinner /> {text}</> : text);

  return (
    <Card className={`border ${disconnected ? 'border-border bg-muted/40 opacity-60' : platform.color}`}>
      <CardContent className="pt-6 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-2xl" aria-hidden>{platform.icon}</span>
            <div className="min-w-0">
              {editing ? (
                <input
                  autoFocus
                  aria-label="Nome da conta"
                  maxLength={60}
                  value={draft}
                  placeholder={account.name}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={onNameKey}
                  onBlur={onNameBlur}
                  className="w-full rounded-md border border-border bg-background px-2 py-1 text-sm font-semibold"
                />
              ) : (
                <div className="flex items-center gap-1">
                  <p className="font-semibold text-sm truncate">{account.displayName ?? account.name}</p>
                  {isAdmin ? (
                    <button
                      type="button"
                      onClick={startEditing}
                      disabled={busy}
                      aria-label="Editar nome"
                      title="Editar nome"
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      {pending === 'rename' ? <Spinner /> : <PencilIcon />}
                    </button>
                  ) : null}
                </div>
              )}
              {account.displayName ? <p className="text-xs text-muted-foreground">{account.name}</p> : null}
              <p className="text-xs text-muted-foreground">{platform.label} · Origem: {account.source}</p>
            </div>
          </div>
          <Badge className={badge.className}>{badge.label}</Badge>
        </div>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground border-t pt-3">
          <span>{account.orderCount} pedidos sincronizados</span>
          <span>Última sincronização: {formatDate(account.lastSyncedAt) ?? 'ainda não sincronizada'}</span>
          {disconnected ? null : <span>Próxima sincronização: {formatDate(account.nextSyncAt) ?? 'não agendada'}</span>}
        </div>

        {account.expectedTotal !== null && account.syncStatus !== 'COMPLETE' && !disconnected ? (
          <p className="text-xs text-amber-700">
            Sincronização pendente. {account.expectedTotal} pedidos informados nesta janela; {account.importedCount} armazenados no histórico.
          </p>
        ) : null}
        {account.syncError ? <p className="text-xs text-red-700">Estado: {account.syncError}</p> : null}
        {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="text-xs text-green-700">{notice}</p> : null}

        {disconnected ? (
          isAdmin ? (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={reconnect} disabled={busy}>{label('reconnect', 'Reconectar')}</Button>
              <Button variant="destructive" onClick={remove} disabled={busy}>{label('remove', 'Remover')}</Button>
            </div>
          ) : null
        ) : (
          <div className="flex gap-2">
            <Button className="flex-1" onClick={sync} disabled={busy}>{label('sync', 'Sincronizar agora')}</Button>
            {isAdmin ? (
              <Button variant="outline" onClick={disconnect} disabled={busy}>{label('disconnect', 'Desconectar')}</Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
