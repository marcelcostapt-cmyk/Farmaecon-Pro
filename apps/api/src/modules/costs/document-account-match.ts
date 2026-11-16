import { normalizeCnpj, isValidCnpj } from '../../shared/fiscal/cnpj';

/**
 * Vínculo documento de compra → UMA conta ML do tenant (regra 3.5, decisões §5 confirmadas).
 * Lógica PURA, independente do schema: opera sobre identidades de conta já cadastradas.
 *
 * Decisões confirmadas (NÃO reabrir):
 *  #1 Candidatas = TODAS as contas do tenant (inclui desconectadas, para rever notas históricas).
 *  #2 Auto-confirma SÓ com CNPJ válido e exato do destinatário e exatamente 1 candidato elegível.
 *  #3 Nome/razão social normalizada NUNCA confirma — no máximo sugere, mantendo PENDING_REVIEW.
 *  #4 2+ candidatos com o mesmo CNPJ → PENDING_REVIEW (seleção explícita).
 *  #5 CNPJ ausente/inválido/divergente → pendente; o nome não encobre a divergência de CNPJ.
 * Nenhum custo é publicado por este vínculo.
 */

export interface MlAccountIdentity {
  id: string;
  status: string; // TODAS as contas participam; o status é informativo, não filtra candidatura
  name: string; // identificador técnico (ML #<sellerId>)
  cnpj?: string | null;
  officialName?: string | null; // razão social / displayName
}

export interface DocumentParty {
  recipientCnpj?: string | null; // DESTINATÁRIO do documento (comprador), nunca o emitente
  recipientName?: string | null;
}

export type AccountMatchReason =
  | 'cnpj' // confirmado: CNPJ válido, exato, único candidato
  | 'name_suggestion' // nome bate: só sugestão, exige revisão
  | 'ambiguous' // 2+ contas com o mesmo CNPJ
  | 'invalid_document_cnpj' // CNPJ do documento presente mas inválido
  | 'cnpj_no_match' // CNPJ válido do documento sem conta igual (divergência)
  | 'no_match'
  | 'no_accounts'
  | 'no_document_identity';

export interface AccountMatchResult {
  accountId: string | null;
  reason: AccountMatchReason;
  requiresReview: boolean; // false só quando há vínculo único e inequívoco por CNPJ válido
  candidates: string[]; // ids de contas consideradas/sugeridas no critério que decidiu
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

/** Sugestões por nome (só para revisão humana; nunca confirmam). */
function sugestoesPorNome(docNome: string, candidatas: MlAccountIdentity[]): string[] {
  if (!docNome) return [];
  return candidatas.filter((a) => normalizeCompanyName(a.officialName) === docNome).map((a) => a.id);
}

export function resolveDocumentAccount(doc: DocumentParty, accounts: MlAccountIdentity[]): AccountMatchResult {
  // Decisão #1: todas as contas do tenant são candidatas (não filtra por status).
  const candidatas = accounts;
  if (candidatas.length === 0) {
    return { accountId: null, reason: 'no_accounts', requiresReview: true, candidates: [] };
  }

  const docCnpjRaw = normalizeCnpj(doc.recipientCnpj);
  const docNome = normalizeCompanyName(doc.recipientName);
  if (!docCnpjRaw && !docNome) {
    return { accountId: null, reason: 'no_document_identity', requiresReview: true, candidates: [] };
  }

  // Prioridade 1: CNPJ do destinatário.
  if (docCnpjRaw) {
    // Decisão #5: CNPJ presente mas inválido → pendente (o nome não pode substituir).
    if (!isValidCnpj(docCnpjRaw)) {
      return { accountId: null, reason: 'invalid_document_cnpj', requiresReview: true, candidates: [] };
    }
    const porCnpj = candidatas.filter((a) => a.cnpj && isValidCnpj(a.cnpj) && normalizeCnpj(a.cnpj) === docCnpjRaw);
    if (porCnpj.length === 1) {
      return { accountId: porCnpj[0].id, reason: 'cnpj', requiresReview: false, candidates: [porCnpj[0].id] };
    }
    if (porCnpj.length > 1) {
      return { accountId: null, reason: 'ambiguous', requiresReview: true, candidates: porCnpj.map((a) => a.id) };
    }
    // Decisão #5: CNPJ válido sem conta igual = divergência. Mantém pendente; o nome só sugere
    // candidatos para revisão, sem encobrir a divergência (accountId permanece null).
    return { accountId: null, reason: 'cnpj_no_match', requiresReview: true, candidates: sugestoesPorNome(docNome, candidatas) };
  }

  // Sem CNPJ no documento: só há o nome → decisão #3, nunca confirma, só sugere.
  const porNome = sugestoesPorNome(docNome, candidatas);
  if (porNome.length >= 1) {
    return { accountId: null, reason: 'name_suggestion', requiresReview: true, candidates: porNome };
  }

  return { accountId: null, reason: 'no_match', requiresReview: true, candidates: [] };
}
