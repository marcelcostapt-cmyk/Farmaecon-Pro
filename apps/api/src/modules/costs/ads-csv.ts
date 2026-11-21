import { Prisma } from '@prisma/client';

// Importação manual de gastos de ADS (publicidade) em CSV. Função pura.
// Colunas: data (AAAA-MM-DD ou DD/MM/AAAA), valor (1234,56 ou 1234.56), sku (opcional), campanha (opcional).
// Delimitador: ';' ou ',' (detetado pelo cabeçalho, ignorando texto entre aspas).
// Aspas: um campo pode vir entre aspas (podendo conter o delimitador); "" dentro do campo é uma aspa.
// NÃO suportado: campo com quebra de linha. Uma linha com aspas abertas e não fechadas é recusada.
// Qualquer linha inválida rejeita o ficheiro inteiro (tudo ou nada).

export const ADS_MAX_ROWS = 20000;
export const ADS_MAX_BYTES = 2 * 1024 * 1024;

export interface AdsRow {
  line: number;
  day: string; // AAAA-MM-DD
  sku: string | null;
  campaign: string | null;
  amount: Prisma.Decimal;
}

export interface AdsParseResult {
  rows: AdsRow[];
  errors: string[];
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function toIsoDay(raw: string): string | null {
  const iso = ISO.exec(raw);
  if (iso) return isValidDay(+iso[1], +iso[2], +iso[3]) ? raw : null;
  const br = BR.exec(raw);
  if (br) {
    const [, d, m, y] = br;
    return isValidDay(+y, +m, +d) ? `${y}-${m}-${d}` : null;
  }
  return null;
}

function isValidDay(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** Aceita 1234,56 · 1.234,56 · 1234.56 · 1,234.56 (último separador é o decimal). Negativo é recusado. */
function toAmount(raw: string): Prisma.Decimal | null {
  const t = raw.trim();
  if (t === '') return null;
  let normalized: string;
  const lastComma = t.lastIndexOf(',');
  const lastDot = t.lastIndexOf('.');
  if (lastComma > lastDot) normalized = t.replace(/\./g, '').replace(',', '.');
  else normalized = t.replace(/,/g, '');
  if (!/^\d+(\.\d{1,4})?$/.test(normalized)) return null;
  return new Prisma.Decimal(normalized);
}

/** Divide uma linha em campos. Retorna erro se houver aspas não fechadas ou fechadas antes do fim do campo. */
export function splitCsvLine(line: string, delimiter: string): { cells: string[]; error: string | null } {
  const cells: string[] = [];
  let i = 0;
  while (true) {
    while (i < line.length && line[i] === ' ') i++;
    if (line[i] === '"') {
      let value = '';
      i++;
      let closed = false;
      while (i < line.length) {
        if (line[i] === '"') {
          if (line[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          closed = true;
          i++;
          break;
        }
        value += line[i++];
      }
      if (!closed) return { cells, error: 'aspas não fechadas nesta linha (campos com quebra de linha não são suportados)' };
      while (i < line.length && line[i] === ' ') i++;
      if (i < line.length && line.slice(i, i + delimiter.length) !== delimiter) {
        return { cells, error: 'texto depois de campo entre aspas' };
      }
      cells.push(value.trim());
    } else {
      const end = line.indexOf(delimiter, i);
      const raw = end < 0 ? line.slice(i) : line.slice(i, end);
      cells.push(raw.trim());
      i = end < 0 ? line.length : end;
    }
    if (i >= line.length) break;
    i += delimiter.length; // consome o delimitador e lê o próximo campo
    if (i >= line.length) {
      cells.push('');
      break;
    }
  }
  return { cells, error: null };
}

/** Delimitador: ';' se houver ';' fora de aspas no cabeçalho; senão ','. */
function detectDelimiter(header: string): string {
  let quoted = false;
  for (const ch of header) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ';') return ';';
  }
  return ',';
}

export function parseAdsCsv(text: string): AdsParseResult {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const numbered = lines.map((l, i) => ({ line: i + 1, text: l })).filter((l) => l.text.trim() !== '');
  if (numbered.length === 0) return { rows: [], errors: ['Ficheiro vazio.'] };

  const header = numbered[0];
  const delimiter = detectDelimiter(header.text);
  const headerSplit = splitCsvLine(header.text, delimiter);
  if (headerSplit.error) return { rows: [], errors: [`Cabeçalho: ${headerSplit.error}.`] };
  const cols = headerSplit.cells.map((c) => c.toLowerCase());
  const idx = (name: string) => cols.indexOf(name);
  const dataCol = idx('data');
  const valorCol = idx('valor');
  if (dataCol < 0 || valorCol < 0) return { rows: [], errors: ['Cabeçalho deve conter as colunas "data" e "valor".'] };
  const skuCol = idx('sku');
  const campCol = idx('campanha');

  const body = numbered.slice(1);
  if (body.length > ADS_MAX_ROWS) return { rows: [], errors: [`Máximo de ${ADS_MAX_ROWS} linhas por ficheiro.`] };

  const rows: AdsRow[] = [];
  for (const { line, text: content } of body) {
    const split = splitCsvLine(content, delimiter);
    if (split.error) {
      errors.push(`Linha ${line}: ${split.error}.`);
      continue;
    }
    const cells = split.cells;
    const day = toIsoDay(cells[dataCol] ?? '');
    const amount = toAmount(cells[valorCol] ?? '');
    if (day === null) {
      errors.push(`Linha ${line}: data inválida "${cells[dataCol] ?? ''}" (use AAAA-MM-DD ou DD/MM/AAAA).`);
      continue;
    }
    if (amount === null) {
      errors.push(`Linha ${line}: valor inválido "${cells[valorCol] ?? ''}".`);
      continue;
    }
    rows.push({
      line,
      day,
      sku: skuCol >= 0 && cells[skuCol] ? cells[skuCol] : null,
      campaign: campCol >= 0 && cells[campCol] ? cells[campCol] : null,
      amount,
    });
  }
  return { rows, errors };
}

export interface AdsCsvSummary {
  rows: number;
  firstDay: string | null;
  lastDay: string | null;
  total: Prisma.Decimal;
  unallocated: Prisma.Decimal;
  bySku: Array<{ sku: string; amount: Prisma.Decimal }>;
  byCampaign: Array<{ campaign: string; amount: Prisma.Decimal }>;
}

/** Resumo de linhas já validadas (pré-visualização). Nada é gravado. */
export function summarizeAdsRows(rows: AdsRow[]): AdsCsvSummary {
  let total = new Prisma.Decimal(0);
  let unallocated = new Prisma.Decimal(0);
  const bySku = new Map<string, Prisma.Decimal>();
  const byCampaign = new Map<string, Prisma.Decimal>();
  let first: string | null = null;
  let last: string | null = null;
  for (const r of rows) {
    total = total.plus(r.amount);
    if (first === null || r.day < first) first = r.day;
    if (last === null || r.day > last) last = r.day;
    if (r.sku === null) unallocated = unallocated.plus(r.amount);
    else bySku.set(r.sku, (bySku.get(r.sku) ?? new Prisma.Decimal(0)).plus(r.amount));
    const campaign = r.campaign ?? '(sem campanha)';
    byCampaign.set(campaign, (byCampaign.get(campaign) ?? new Prisma.Decimal(0)).plus(r.amount));
  }
  return {
    rows: rows.length,
    firstDay: first,
    lastDay: last,
    total,
    unallocated,
    bySku: [...bySku.entries()].map(([sku, amount]) => ({ sku, amount })),
    byCampaign: [...byCampaign.entries()].map(([campaign, amount]) => ({ campaign, amount })),
  };
}
