import { normalizeCnpj } from './invoice-key';

/**
 * Validação da chave de acesso da NF-e (44 dígitos). A chave é tratada como TEXTO.
 * Comprimento + dígito verificador comprovam apenas consistência estrutural — NÃO
 * provam autenticidade fiscal. Conflito com os campos identificadores, chave
 * inválida ou ausência de dados obrigatórios devem levar o documento a pending_review.
 * Nunca se inventa uma chave: na ausência, usa-se identidade provisória.
 */

export interface InvoiceKeyParts {
  uf: string;
  aamm: string;
  cnpj: string;
  modelo: string;
  serie: string;
  numero: string;
  tpEmis: string;
  cNF: string;
  dv: string;
}

const onlyDigits = (s: string | null | undefined): string => (s ?? '').replace(/\D/g, '');

/** Dígito verificador mod-11 sobre os primeiros 43 dígitos (pesos 2..9 cíclicos, direita→esquerda). */
export function invoiceKeyCheckDigit(first43: string): number {
  let peso = 2;
  let soma = 0;
  for (let i = first43.length - 1; i >= 0; i--) {
    soma += Number(first43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const resto = soma % 11;
  return resto === 0 || resto === 1 ? 0 : 11 - resto;
}

export function parseInvoiceKeyParts(key: string): InvoiceKeyParts | null {
  const d = onlyDigits(key);
  if (d.length !== 44) return null;
  return {
    uf: d.slice(0, 2),
    aamm: d.slice(2, 6),
    cnpj: d.slice(6, 20),
    modelo: d.slice(20, 22),
    serie: d.slice(22, 25),
    numero: d.slice(25, 34),
    tpEmis: d.slice(34, 35),
    cNF: d.slice(35, 43),
    dv: d.slice(43, 44),
  };
}

/** true se a chave tiver 44 dígitos e o DV mod-11 conferir. Não prova autenticidade fiscal. */
export function isStructurallyValidInvoiceKey(key: string | null | undefined): boolean {
  const d = onlyDigits(key);
  if (d.length !== 44) return false;
  return invoiceKeyCheckDigit(d.slice(0, 43)) === Number(d[43]);
}

export interface ExpectedInvoiceFields {
  issuerCnpj?: string | null;
  modelo?: string | null;
  serie?: string | null;
  numero?: string | null;
  issuedAt?: Date | null;
}

export interface InvoiceKeyValidation {
  present: boolean;
  lengthOk: boolean;
  checkDigitOk: boolean;
  valid: boolean; // estrutura (44 díg + DV); NÃO prova autenticidade
  conflicts: string[]; // campos identificadores que divergem da chave
  requiresReview: boolean; // chave presente inválida OU conflito → pending_review
}

const aammDe = (d: Date): string =>
  `${String(d.getUTCFullYear() % 100).padStart(2, '0')}${String(d.getUTCMonth() + 1).padStart(2, '0')}`;

export function validateInvoiceKey(
  key: string | null | undefined,
  expected: ExpectedInvoiceFields = {},
): InvoiceKeyValidation {
  const present = !!onlyDigits(key);
  const d = onlyDigits(key);
  const lengthOk = d.length === 44;
  const checkDigitOk = lengthOk && invoiceKeyCheckDigit(d.slice(0, 43)) === Number(d[43]);
  const valid = lengthOk && checkDigitOk;

  const conflicts: string[] = [];
  const parts = valid ? parseInvoiceKeyParts(d) : null;
  if (parts) {
    if (expected.issuerCnpj != null && normalizeCnpj(expected.issuerCnpj) !== parts.cnpj) conflicts.push('cnpj');
    if (expected.modelo != null && onlyDigits(expected.modelo).padStart(2, '0') !== parts.modelo) conflicts.push('modelo');
    if (expected.serie != null && onlyDigits(expected.serie).padStart(3, '0') !== parts.serie) conflicts.push('serie');
    if (expected.numero != null && onlyDigits(expected.numero).padStart(9, '0') !== parts.numero) conflicts.push('numero');
    if (expected.issuedAt != null && aammDe(expected.issuedAt) !== parts.aamm) conflicts.push('aamm');
  }

  const requiresReview = (present && !valid) || conflicts.length > 0;
  return { present, lengthOk, checkDigitOk, valid, conflicts, requiresReview };
}

/**
 * Identidade provisória para documento sem chave de acesso. Exige, no mínimo,
 * emitente + número — senão devolve null (não inventa identidade). Nunca produz
 * uma "chave" de 44 dígitos falsa.
 */
export function provisionalInvoiceIdentity(f: ExpectedInvoiceFields): string | null {
  const cnpj = normalizeCnpj(f.issuerCnpj);
  const numero = onlyDigits(f.numero);
  if (!cnpj || !numero) return null;
  const modelo = onlyDigits(f.modelo) || '55';
  const serie = onlyDigits(f.serie) || '0';
  const data = f.issuedAt ? f.issuedAt.toISOString().slice(0, 10) : 'sem-data';
  return `provisorio:${cnpj}:${modelo}:${serie}:${numero}:${data}`;
}
