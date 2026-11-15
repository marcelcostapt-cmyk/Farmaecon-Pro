import { normalizeCnpj } from './invoice-key';

/**
 * Vínculo documento de compra → UMA conta ML ativa do tenant (regra 3.5).
 * Lógica PURA, independente do schema: opera sobre identidades de conta já cadastradas.
 *
 * ⚠️ PRÉ-REQUISITO: hoje `marketplace_accounts` não tem CNPJ/razão social. Para usar
 * este matcher é preciso popular `cnpj`/`officialName` (ML /users/me ou cadastro manual)
 * — e quem autoriza o vínculo é a decisão de negócio #1. Nenhum custo é publicado sem vínculo.
 */

export interface MlAccountIdentity {
  id: string;
  status: string; // só ACTIVE participa do match
  name: string; // identificador técnico (ML #<sellerId>)
  cnpj?: string | null;
  officialName?: string | null; // razão social / displayName
}

export interface DocumentParty {
  recipientCnpj?: string | null;
  recipientName?: string | null;
}

export type AccountMatchReason =
  | 'cnpj'
  | 'name'
  | 'ambiguous'
  | 'no_match'
  | 'no_active_accounts'
  | 'no_document_identity';

export interface AccountMatchResult {
  accountId: string | null;
  reason: AccountMatchReason;
  requiresReview: boolean; // false só quando há vínculo único e inequívoco
  candidates: string[]; // ids de contas consideradas no critério que decidiu
}

const SUFIXOS = /\b(LTDA|ME|EPP|EIRELI|SA|S\s?A|CIA|LTD)\b/g;

/** Normaliza razão social para comparação: sem acentos, maiúsculas, sem sufixo societário/pontuação. */
export function normalizeCompanyName(s?: string | null): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(SUFIXOS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function resolveDocumentAccount(doc: DocumentParty, accounts: MlAccountIdentity[]): AccountMatchResult {
  const ativas = accounts.filter((a) => a.status === 'ACTIVE');
  if (ativas.length === 0) {
    return { accountId: null, reason: 'no_active_accounts', requiresReview: true, candidates: [] };
  }

  const docCnpj = normalizeCnpj(doc.recipientCnpj);
  const docNome = normalizeCompanyName(doc.recipientName);
  if (!docCnpj && !docNome) {
    return { accountId: null, reason: 'no_document_identity', requiresReview: true, candidates: [] };
  }

  // Prioridade 1: CNPJ do destinatário.
  if (docCnpj) {
    const porCnpj = ativas.filter((a) => normalizeCnpj(a.cnpj) === docCnpj);
    if (porCnpj.length === 1) {
      return { accountId: porCnpj[0].id, reason: 'cnpj', requiresReview: false, candidates: porCnpj.map((a) => a.id) };
    }
    if (porCnpj.length > 1) {
      return { accountId: null, reason: 'ambiguous', requiresReview: true, candidates: porCnpj.map((a) => a.id) };
    }
  }

  // Prioridade 2: nome da loja (razão social).
  if (docNome) {
    const porNome = ativas.filter((a) => normalizeCompanyName(a.officialName) === docNome && docNome.length > 0);
    if (porNome.length === 1) {
      return { accountId: porNome[0].id, reason: 'name', requiresReview: false, candidates: porNome.map((a) => a.id) };
    }
    if (porNome.length > 1) {
      return { accountId: null, reason: 'ambiguous', requiresReview: true, candidates: porNome.map((a) => a.id) };
    }
  }

  return { accountId: null, reason: 'no_match', requiresReview: true, candidates: [] };
}
