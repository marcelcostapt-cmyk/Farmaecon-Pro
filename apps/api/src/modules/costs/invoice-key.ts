import type { UnifiedInvoice } from './document-parser';

/**
 * Chave de negócio de um documento fiscal, para deduplicar e reconciliar sem
 * depender do nome do ficheiro (o mesmo documento pode chegar com nomes diferentes).
 *
 * - Com chave de acesso da NF-e (44 dígitos): identificador canónico e estável.
 * - Sem chave: composição determinística com número, série, CNPJs e data de emissão.
 *
 * ⚠️ PRIVACIDADE: o ramo composto inclui CNPJs reais. Use esta chave apenas para
 * agrupar/deduplicar em memória; NÃO a imprima em logs nem a persista em claro.
 * Para exibição, prefira o número da NF-e ou o sha256 do conteúdo.
 */
export function invoiceBusinessKey(inv: UnifiedInvoice): string {
  if (inv.invoiceKey) return `chave:${inv.invoiceKey}`;
  const data = inv.issuedAt ? inv.issuedAt.toISOString().slice(0, 10) : '';
  return `nf:${inv.invoiceNumber ?? ''}:${inv.invoiceSeries ?? ''}:${inv.issuerCnpj ?? ''}:${inv.recipientCnpj ?? ''}:${data}`;
}
