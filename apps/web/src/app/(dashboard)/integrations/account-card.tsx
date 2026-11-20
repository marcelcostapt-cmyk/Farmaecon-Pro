'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { ProxyResult } from '@/app/api/integrations/api-bridge';
import type { Account } from './types';
import { isValidCnpj, formatCnpj } from './cnpj-format';

type Action = 'identity' | 'sync' | 'disconnect' | 'reconnect' | 'remove';

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

function Spinner() {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" className="animate-spin" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M8 2a6 6 0 1 0 6 6" strokeLinecap="round" />
    </svg>
  );
}

// Título: nome no painel → nickname/nome técnico → ML #<sellerId>.
function accountTitle(account: Account): string {
  return account.displayName?.trim() || account.name || (account.externalSellerId ? `ML #${account.externalSellerId}` : 'Conta ML');
}

export default function AccountCard({ account, isAdmin }: { account: Account; isAdmin: boolean }) {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [fDisplay, setFDisplay] = useState(account.displayName ?? '');
  const [fBusiness, setFBusiness] = useState(account.businessName ?? '');
  const [fCnpj, setFCnpj] = useState(account.cnpj ?? '');

  const platform = PLATFORMS[account.platform] ?? { label: account.platform, color: '', icon: '🔌' };
  const disconnected = account.status === 'DISCONNECTED';
  const syncing = !disconnected && (account.syncStatus === 'PARTIAL' || account.syncStatus === 'RUNNING');
  const badge = STATUS_BADGE[syncing ? 'SYNCING' : account.status] ?? STATUS_BADGE.WARNING;
  const busy = pending !== null || isRefreshing;
  const base = `/api/integrations/${encodeURIComponent(account.id)}`;

  const cnpjInvalid = fCnpj.trim() !== '' && !isValidCnpj(fCnpj);

  async function run<T>(action: Action, request: () => Promise<ProxyResult<T>>, onSuccess?: (data: T) => void) {
    setPending(action);
    setError(null);
    setNotice(null);
    const result = await request();
    setPending(null);
    if (!result.ok) {
      setError(result.message);
      return false;
    }
    onSuccess?.(result.data);
    startTransition(() => router.refresh());
    return true;
  }

  function startEditing() {
    setFDisplay(account.displayName ?? '');
    setFBusiness(account.businessName ?? '');
    setFCnpj(account.cnpj ?? '');
    setError(null);
    setNotice(null);
    setEditing(true);
  }

  async function saveIdentity(event: React.FormEvent) {
    event.preventDefault();
    if (cnpjInvalid) return; // validação por campo bloqueia o envio
    // Só os campos que mudaram (preserva omitidos; '' limpa um campo opcional).
    const body: Record<string, string> = {};
    if (fDisplay.trim() !== (account.displayName ?? '')) body.displayName = fDisplay;
    if (fBusiness.trim() !== (account.businessName ?? '')) body.businessName = fBusiness;
    if (fCnpj.trim() !== (account.cnpj ?? '')) body.cnpj = fCnpj;
    if (Object.keys(body).length === 0) {
      setEditing(false);
      return;
    }
    const okSaved = await run('identity', () => callApi(base, 'PATCH', body), () => setNotice('Identificação salva.'));
    if (okSaved) setEditing(false); // uma falha mantém o formulário e não apaga nada já salvo
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
      window.location.assign(result.data.url);
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
              <p className="font-semibold text-sm truncate">{accountTitle(account)}</p>
              {account.displayName ? <p className="text-xs text-muted-foreground truncate">Apelido ML: {account.name}</p> : null}
              <p className="text-xs text-muted-foreground">
                Vendedor ML: {account.externalSellerId ? `#${account.externalSellerId}` : '—'} · {platform.label} · Origem: {account.source}
              </p>
            </div>
          </div>
          <Badge className={badge.className}>{badge.label}</Badge>
        </div>

        <div className="flex flex-col gap-1 text-xs text-muted-foreground border-t pt-3">
          <span>{account.orderCount} pedidos sincronizados</span>
          <span>Última sincronização: {formatDate(account.lastSyncedAt) ?? 'ainda não sincronizada'}</span>
          {disconnected ? null : <span>Próxima sincronização: {formatDate(account.nextSyncAt) ?? 'não agendada'}</span>}
        </div>

        {/* Identidade fiscal da empresa compradora (destinatário das notas). */}
        <div className="flex flex-col gap-1 text-xs border-t pt-3">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Razão social:</span>
            <span className="font-medium">{account.businessName ?? '—'}</span>
            {account.businessName || account.cnpj ? (
              <span className="rounded bg-blue-500/10 text-blue-700 px-1.5 py-0.5 text-[10px]">informado</span>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">CNPJ:</span>
            <span className="font-mono">{account.cnpj ? formatCnpj(account.cnpj) : '—'}</span>
          </div>
        </div>

        {account.expectedTotal !== null && account.syncStatus !== 'COMPLETE' && !disconnected ? (
          <p className="text-xs text-amber-700">
            Sincronização pendente. {account.expectedTotal} pedidos informados nesta janela; {account.importedCount} armazenados no histórico.
          </p>
        ) : null}
        {account.syncError ? <p className="text-xs text-red-700">Estado: {account.syncError}</p> : null}
        {error ? <p role="alert" className="text-xs text-red-700">{error}</p> : null}
        {notice ? <p role="status" className="text-xs text-green-700">{notice}</p> : null}

        {isAdmin && editing ? (
          <form onSubmit={saveIdentity} className="flex flex-col gap-2 border-t pt-3">
            <p className="text-[11px] text-muted-foreground">
              O nome no painel só organiza as contas. A identidade fiscal (razão social e CNPJ da empresa compradora)
              auxilia o vínculo das notas; o nome amigável nunca é usado para associar documentos automaticamente.
            </p>
            <label className="text-xs flex flex-col gap-1">
              Nome no painel
              <input
                value={fDisplay}
                maxLength={60}
                onChange={(e) => setFDisplay(e.target.value)}
                placeholder={account.name}
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs flex flex-col gap-1">
              Razão social (empresa compradora)
              <input
                value={fBusiness}
                maxLength={255}
                onChange={(e) => setFBusiness(e.target.value)}
                placeholder="Ex.: Drogaria Exemplo LTDA"
                className="rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs flex flex-col gap-1">
              CNPJ da empresa compradora
              <input
                value={fCnpj}
                maxLength={18}
                onChange={(e) => setFCnpj(e.target.value)}
                placeholder="00.000.000/0000-00"
                aria-invalid={cnpjInvalid}
                className={`rounded-md border px-2 py-1 text-sm font-mono ${cnpjInvalid ? 'border-red-500' : 'border-border'} bg-background`}
              />
              {cnpjInvalid ? <span className="text-red-700">CNPJ inválido (verifique os dígitos).</span> : null}
            </label>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1" disabled={busy || cnpjInvalid}>{label('identity', 'Salvar')}</Button>
              <Button type="button" variant="outline" onClick={() => setEditing(false)} disabled={busy}>Cancelar</Button>
            </div>
          </form>
        ) : null}

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

        {isAdmin && !editing ? (
          <button
            type="button"
            onClick={startEditing}
            disabled={busy}
            className="self-start text-xs text-muted-foreground hover:text-foreground underline disabled:opacity-50"
          >
            Editar identificação
          </button>
        ) : null}
      </CardContent>
    </Card>
  );
}
