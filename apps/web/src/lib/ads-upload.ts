// Validação e apresentação do import de CSV de ADS no navegador. Os mesmos limites são aplicados
// no servidor (ads-csv.ts: ADS_MAX_BYTES = 2 MB, ADS_MAX_ROWS = 20 000). Nada sai do navegador
// exceto o envio autenticado à própria API.

export const ADS_MAX_BYTES = 2 * 1024 * 1024;
export const ADS_MAX_ROWS = 20000;

/** Primeiro erro de um ficheiro escolhido (ou null). Não lê o conteúdo; isso é validado no servidor. */
export function validateCsvFile(file: { name: string; size: number }): string | null {
  if (!/\.csv$/i.test(file.name)) return 'Escolha um ficheiro com extensão .csv.';
  if (file.size === 0) return 'O ficheiro está vazio.';
  if (file.size > ADS_MAX_BYTES) return `O ficheiro tem ${(file.size / 1024 / 1024).toFixed(1)} MB. O limite é 2 MB.`;
  return null;
}

/** Valor decimal em texto (ex.: "170.00") para reais: R$ 170,00. */
export function formatBrl(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return 'indisponível';
  const n = Number(value);
  if (!Number.isFinite(n)) return 'indisponível';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** AAAA-MM-DD para DD/MM/AAAA sem passar por fuso horário. */
export function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Percentagem de uma parte sobre o total, com uma casa decimal. Total zero: "—". */
export function percentOf(part: string, total: string): string {
  const t = Number(total);
  if (!Number.isFinite(t) || t === 0) return '—';
  return `${((Number(part) / t) * 100).toFixed(1)}%`;
}
