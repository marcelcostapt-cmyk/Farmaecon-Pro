import type { UnifiedInvoice } from './document-parser';

/** Remove tudo o que não é dígito de um CNPJ (aceita formatado "02.543.945/0003-47"). */
export function normalizeCnpj(cnpj?: string | null): string {
  return (cnpj ?? '').replace(/\D/g, '');
}

/**
 * Chave de negócio de um documento fiscal, para deduplicar e reconciliar sem
 * depender do nome do ficheiro (o mesmo documento pode chegar com nomes diferentes).
 *
 * - Com chave de acesso da NF-e (44 dígitos): identificador canónico e estável.
 * - Sem chave: composição com número, série, CNPJs (normalizados) e data de emissão.
 *   Só é aceite com, no mínimo, número da NF + emitente; caso contrário lança —
 *   recusa uma chave fraca em vez de produzir um identificador ambíguo.
 *
 * ⚠️ PRIVACIDADE: o ramo composto inclui CNPJs reais. Use esta chave apenas para
 * agrupar/deduplicar em memória; NÃO a imprima em logs nem a persista em claro.
 * Para exibição, prefira o número da NF-e ou o sha256 do conteúdo.
 */
export function invoiceBusinessKey(inv: UnifiedInvoice): string {
  if (inv.invoiceKey) return `chave:${inv.invoiceKey}`;

  const issuer = normalizeCnpj(inv.issuerCnpj);
  const recipient = normalizeCnpj(inv.recipientCnpj);
  const date = inv.issuedAt ? inv.issuedAt.toISOString().slice(0, 10) : 'sem-data';

  // Fallback só faz sentido com, pelo menos, número da NF + emitente.
  if (!inv.invoiceNumber || !issuer) {
    throw new Error('NF sem chave de acesso e sem dados mínimos para reconciliação');
  }

  return `nf:${inv.invoiceNumber}:${inv.invoiceSeries ?? '0'}:${issuer}:${recipient}:${date}`;
}
