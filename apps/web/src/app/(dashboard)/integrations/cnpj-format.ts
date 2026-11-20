// Validação de CNPJ no cliente (numérico e alfanumérico, Anexo XV RFB). Espelha o
// validador do backend (que é a autoridade final). Não usa \D — letras são válidas.

const MASCARA = /[.\/\-\s]/g;
const ESTRUTURA = /^[0-9A-Z]{12}[0-9]{2}$/;
const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

export function normalizeCnpj(raw: string): string {
  return raw.replace(MASCARA, '').toUpperCase();
}

function dv(base: string, pesos: number[]): number {
  const soma = base.split('').reduce((acc, c, i) => acc + (c.charCodeAt(0) - 48) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

export function isValidCnpj(raw: string): boolean {
  const cnpj = normalizeCnpj(raw);
  if (!ESTRUTURA.test(cnpj) || /^(.)\1{13}$/.test(cnpj)) return false;
  const base = cnpj.slice(0, 12);
  const d1 = dv(base, PESOS_DV1);
  const d2 = dv(base + String(d1), PESOS_DV2);
  return cnpj.slice(12) === `${d1}${d2}`;
}

// Apenas apresentação: agrupa 14 posições no formato XX.XXX.XXX/XXXX-XX quando completo.
export function formatCnpj(raw: string | null): string {
  if (!raw) return '';
  const c = normalizeCnpj(raw);
  if (c.length !== 14) return raw;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
