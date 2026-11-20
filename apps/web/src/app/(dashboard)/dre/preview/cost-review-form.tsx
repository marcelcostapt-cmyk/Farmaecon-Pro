'use client';

import { useMemo, useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { ProxyResult } from '@/app/api/dre/api-bridge';
import type {
  BonusLineResult,
  BonusResult,
  BonusRule,
  MlAccountOption,
  PreviewLine,
  PublishResult,
  UploadResult,
} from './types';

const RULE_LABEL: Record<BonusRule, string> = {
  PROPORTIONAL: 'Proporcional ao valor (§H) — dilui o bônus em todas as linhas',
  SPECIFIC_SKU: 'Apenas num SKU — todo o bônus recai sobre um EAN',
  IGNORE: 'Ignorar — linha bonificada fica sem custo',
};

const RULE_PUBLISHED: Record<string, string> = {
  PROPORTIONAL_SPREAD: 'Proporcional ao valor',
  MANUAL: 'SKU específico',
  ZERO_BONUS: 'Bonificação ignorada',
};

const dash = (value: string | null | undefined) => (value && value.trim() !== '' ? value : '—');

function accountLabel(account: MlAccountOption): string {
  return account.displayName?.trim() || account.name || (account.externalSellerId ? `ML #${account.externalSellerId}` : account.id);
}

async function callJson<T = unknown>(path: string, body?: unknown): Promise<ProxyResult<T>> {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = (await response.json().catch(() => null)) as ProxyResult<T> | null;
    return result ?? { ok: false, message: 'Resposta inválida do servidor.' };
  } catch {
    return { ok: false, message: 'Sem ligação ao servidor. Tente novamente.' };
  }
}

async function uploadFile(file: File): Promise<ProxyResult<UploadResult>> {
  const form = new FormData();
  form.append('file', file, file.name);
  try {
    const response = await fetch('/api/dre/upload', { method: 'POST', headers: { Accept: 'application/json' }, body: form });
    const result = (await response.json().catch(() => null)) as ProxyResult<UploadResult> | null;
    return result ?? { ok: false, message: 'Resposta inválida do servidor.' };
  } catch {
    return { ok: false, message: 'Sem ligação ao servidor. Tente novamente.' };
  }
}

export default function CostReviewForm({ accounts }: { accounts: MlAccountOption[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<'upload' | 'account' | 'bonus' | 'publish' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [linkedAccountId, setLinkedAccountId] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');

  const [hasBonus, setHasBonus] = useState(false);
  const [bonusAmount, setBonusAmount] = useState('');
  const [rule, setRule] = useState<BonusRule>('PROPORTIONAL');
  const [specificSkuEan, setSpecificSkuEan] = useState('');

  const [suggested, setSuggested] = useState<Map<string, BonusLineResult>>(new Map());
  const [published, setPublished] = useState<PublishResult | null>(null);
  const [confirming, setConfirming] = useState(false);

  const lines: PreviewLine[] = upload?.lines ?? [];
  const invoiceId = upload?.ingest.invoiceId ?? null;
  const canPublish = Boolean(invoiceId && linkedAccountId && suggested.size > 0 && !published);

  const accountName = useMemo(() => {
    const found = accounts.find((a) => a.id === linkedAccountId);
    return found ? accountLabel(found) : null;
  }, [accounts, linkedAccountId]);

  function reset() {
    setUpload(null);
    setLinkedAccountId(null);
    setSelectedAccountId('');
    setHasBonus(false);
    setBonusAmount('');
    setRule('PROPORTIONAL');
    setSpecificSkuEan('');
    setSuggested(new Map());
    setPublished(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError('Escolha um ficheiro (XML, PDF ou XLSX).');
      return;
    }
    setBusy('upload');
    setError(null);
    const result = await uploadFile(file);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setUpload(result.data);
    setPublished(null);
    setSuggested(new Map());
    const linked = result.data.ingest.accountMatch?.linkedAccountId ?? null;
    setLinkedAccountId(linked);
    setSelectedAccountId(linked ?? '');
  }

  async function handleLinkAccount() {
    if (!invoiceId) return;
    if (!selectedAccountId) {
      setError('Escolha a conta ML para vincular o documento.');
      return;
    }
    setBusy('account');
    setError(null);
    const result = await callJson<{ linkedAccountId: string }>(`/api/dre/${invoiceId}/account`, { accountId: selectedAccountId });
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLinkedAccountId(result.data.linkedAccountId);
  }

  async function handleRecalc() {
    if (!invoiceId) return;
    if (hasBonus) {
      const value = Number(bonusAmount);
      if (!bonusAmount || Number.isNaN(value) || value <= 0) {
        setError('Informe o valor da bonificação (maior que zero).');
        return;
      }
      if (rule === 'SPECIFIC_SKU' && !specificSkuEan.trim()) {
        setError('Informe o EAN que recebe toda a bonificação.');
        return;
      }
    }
    setBusy('bonus');
    setError(null);
    const body = {
      hasBonus,
      bonusAmount: hasBonus ? bonusAmount : '0',
      rule: hasBonus ? rule : 'IGNORE',
      ...(hasBonus && rule === 'SPECIFIC_SKU' ? { specificSkuEan: specificSkuEan.trim() } : {}),
    };
    const result = await callJson<BonusResult>(`/api/dre/${invoiceId}/bonus`, body);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSuggested(new Map(result.data.items.map((item) => [item.lineNumber, item])));
    setPublished(null);
  }

  async function handlePublish() {
    if (!invoiceId) return;
    setBusy('publish');
    setError(null);
    const result = await callJson<PublishResult>(`/api/dre/${invoiceId}/publish`, {});
    setBusy(null);
    setConfirming(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setPublished(result.data);
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive" role="alert">
          {error}
        </div>
      ) : null}

      {/* 1. Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">1. Documento de compra</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <input
            ref={fileRef}
            type="file"
            accept=".xml,.pdf,.xlsx,.xls"
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-muted file:px-3 file:py-1.5 file:text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={handleUpload} disabled={busy !== null}>
              {busy === 'upload' ? 'A enviar…' : 'Enviar documento'}
            </Button>
            {upload ? (
              <Button variant="outline" onClick={reset} disabled={busy !== null}>
                Novo
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {upload ? (
        <>
          {/* 2. Conta ML */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">2. Conta Mercado Livre</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {linkedAccountId ? (
                <p className="text-sm">
                  Vinculada a <span className="font-medium">{accountName ?? linkedAccountId}</span>
                  {upload.ingest.accountMatch?.reason === 'cnpj' ? (
                    <Badge className="ml-2 bg-green-500/15 text-green-700">por CNPJ</Badge>
                  ) : null}
                </p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <p className="text-sm text-muted-foreground">Documento sem vínculo automático. Escolha a conta:</p>
                  <select
                    value={selectedAccountId}
                    onChange={(event) => setSelectedAccountId(event.target.value)}
                    className="h-9 rounded-md border border-border bg-background px-2 text-sm"
                  >
                    <option value="">Selecionar conta…</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {accountLabel(account)}
                        {account.cnpj ? ` · ${account.cnpj}` : ''}
                      </option>
                    ))}
                  </select>
                  <Button onClick={handleLinkAccount} disabled={busy !== null}>
                    {busy === 'account' ? 'A vincular…' : 'Vincular conta'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* 3. Itens */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3. Itens do documento ({lines.length})</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>EAN</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">Custo bruto</TableHead>
                    <TableHead className="text-right">Custo sugerido</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const hit = suggested.get(line.lineNumber);
                    return (
                      <TableRow key={line.lineNumber}>
                        <TableCell>{dash(line.marketplaceSku ?? line.supplierProductCode)}</TableCell>
                        <TableCell>{dash(line.ean)}</TableCell>
                        <TableCell className="max-w-xs truncate">
                          {dash(line.description)}
                          {line.isBonus ? <Badge className="ml-2 bg-yellow-400/20 text-yellow-800">bonif.</Badge> : null}
                        </TableCell>
                        <TableCell className="text-right">{dash(line.quantity)}</TableCell>
                        <TableCell className="text-right">{dash(line.unitCostPaid ?? line.unitCostExtracted)}</TableCell>
                        <TableCell className="text-right font-medium">
                          {hit ? (hit.unitCostApproved ?? 'indisponível') : '—'}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* 4. Bonificação */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">4. Bonificação</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={hasBonus} onChange={(event) => setHasBonus(event.target.checked)} />
                Este documento tem bonificação?
              </label>

              {hasBonus ? (
                <div className="flex flex-col gap-3">
                  <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
                    Valor bonificado (obrigatório)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={bonusAmount}
                      onChange={(event) => setBonusAmount(event.target.value)}
                      className="h-9 rounded-md border border-border bg-background px-2"
                      placeholder="0,00"
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    Regra
                    <select
                      value={rule}
                      onChange={(event) => setRule(event.target.value as BonusRule)}
                      className="h-9 rounded-md border border-border bg-background px-2 sm:max-w-md"
                    >
                      {(Object.keys(RULE_LABEL) as BonusRule[]).map((key) => (
                        <option key={key} value={key}>
                          {RULE_LABEL[key]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {rule === 'SPECIFIC_SKU' ? (
                    <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
                      EAN que recebe o bônus
                      <input
                        value={specificSkuEan}
                        onChange={(event) => setSpecificSkuEan(event.target.value)}
                        className="h-9 rounded-md border border-border bg-background px-2"
                        placeholder="789…"
                      />
                    </label>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Sem bonificação: o custo é o valor pago por unidade.</p>
              )}

              <div>
                <Button variant="secondary" onClick={handleRecalc} disabled={busy !== null}>
                  {busy === 'bonus' ? 'A recalcular…' : 'Recalcular custos'}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* 5. Publicar */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">5. Aprovar e publicar</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {published ? (
                <div className="rounded-lg border border-green-500/40 bg-green-500/10 px-4 py-3 text-sm">
                  <p className="font-medium text-green-700">
                    {published.publishedCount} custo(s) publicado(s) · regra {RULE_PUBLISHED[published.ruleType] ?? published.ruleType}
                  </p>
                  <ul className="mt-2 space-y-0.5 text-muted-foreground">
                    {published.costs.map((cost, index) => (
                      <li key={`${cost.ean ?? cost.sku ?? index}`}>
                        {dash(cost.sku ?? cost.ean)} → {cost.unitCost}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    A publicação grava os custos aprovados em <code>product_costs</code> para a conta vinculada. Recalcule os custos e vincule uma conta antes de publicar.
                  </p>
                  <div>
                    <Button onClick={() => setConfirming(true)} disabled={!canPublish || busy !== null}>
                      Aprovar e publicar
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {/* Modal de confirmação */}
      {confirming ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-xl border border-border bg-background p-5 shadow-lg">
            <h2 className="text-base font-semibold">Confirmar publicação</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Vai publicar os custos aprovados para <span className="font-medium">{accountName ?? 'a conta vinculada'}</span>. Esta ação grava custos definitivos.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy === 'publish'}>
                Cancelar
              </Button>
              <Button onClick={handlePublish} disabled={busy === 'publish'}>
                {busy === 'publish' ? 'A publicar…' : 'Confirmar e publicar'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
