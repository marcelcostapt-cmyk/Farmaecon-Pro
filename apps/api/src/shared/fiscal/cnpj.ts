// Validação de CNPJ numérico e alfanumérico conforme a especificação da Receita
// Federal (Anexo XV / Nota Técnica do CNPJ alfanumérico). O valor de cada posição
// base é ASCII(char) − 48 ('0'..'9' → 0..9; 'A'..'Z' → 17..42). Os 2 dígitos
// verificadores são sempre numéricos, calculados por módulo 11.

const CHARS_VALIDOS = /^[0-9A-Z]{12}[0-9]{2}$/;
// Máscara prevista: pontos, barra, hífen e espaços. NÃO remover letras (\D apagaria letra válida).
const MASCARA = /[.\/\-\s]/g;

/** Remove só a máscara prevista e espaços, normaliza letras para maiúsculas, preserva zeros. */
export function normalizeCnpj(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const limpo = raw.replace(MASCARA, '').toUpperCase();
  return limpo.length === 0 ? null : limpo;
}

function valorPosicao(char: string): number {
  return char.charCodeAt(0) - 48;
}

function digitoVerificador(base: string, pesos: number[]): number {
  const soma = base
    .split('')
    .reduce((acc, char, i) => acc + valorPosicao(char) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

const PESOS_DV1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const PESOS_DV2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

/**
 * Valida estrutura (14 posições, base alfanumérica + 2 DV numéricos) e dígitos
 * verificadores. Contar 14 caracteres não basta; formato/DV não comprova
 * titularidade (isso regista-se como origem manual/revisão no cadastro).
 */
export function isValidCnpj(raw: string | null | undefined): boolean {
  const cnpj = normalizeCnpj(raw);
  if (!cnpj || !CHARS_VALIDOS.test(cnpj)) return false;
  // Rejeita repetição trivial (ex.: 00000000000000) que passaria no módulo 11.
  if (/^(.)\1{13}$/.test(cnpj)) return false;
  const base = cnpj.slice(0, 12);
  const dv1 = digitoVerificador(base, PESOS_DV1);
  const dv2 = digitoVerificador(base + String(dv1), PESOS_DV2);
  return cnpj.slice(12) === `${dv1}${dv2}`;
}

const ACENTOS = /[̀-ͯ]/g;
const SUFIXOS_SOCIETARIOS = /\b(LTDA|ME|EPP|EIRELI|S\/?A|SA|MEI|CIA|EI)\b/g;

/**
 * Normaliza a razão social (sem acentos/pontuação/sufixos societários, maiúsculas)
 * APENAS para sugerir candidatos na busca. O texto original é sempre preservado à
 * parte; a normalização nunca confirma vínculo fiscal nem encobre divergência de CNPJ.
 */
export function normalizeBusinessName(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const semAcentos = raw.normalize('NFD').replace(ACENTOS, '');
  const maiusc = semAcentos.toUpperCase();
  const semPontuacao = maiusc.replace(/[^A-Z0-9\s\/]/g, ' ');
  const semSufixos = semPontuacao.replace(SUFIXOS_SOCIETARIOS, ' ');
  const limpo = semSufixos.replace(/[\/]/g, ' ').replace(/\s+/g, ' ').trim();
  return limpo.length === 0 ? null : limpo;
}
