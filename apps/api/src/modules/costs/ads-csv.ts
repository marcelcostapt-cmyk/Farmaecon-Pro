import { Prisma } from '@prisma/client';

// Importação manual de gastos de ADS (publicidade) em CSV. Função pura.
// Colunas: data (AAAA-MM-DD ou DD/MM/AAAA), valor (1234,56 ou 1234.56), sku (opcional), campanha (opcional).
// Delimitador: ';' ou ',' (detetado pelo cabeçalho). Qualquer linha inválida rejeita o ficheiro inteiro.

export const ADS_MAX_ROWS = 20000;

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

export function parseAdsCsv(text: string): AdsParseResult {
  const errors: string[] = [];
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const numbered = lines.map((l, i) => ({ line: i + 1, text: l })).filter((l) => l.text.trim() !== '');
  if (numbered.length === 0) return { rows: [], errors: ['Ficheiro vazio.'] };

  const header = numbered[0];
  const delimiter = header.text.includes(';') ? ';' : ',';
  const cols = header.text.split(delimiter).map((c) => c.trim().toLowerCase());
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
    const cells = content.split(delimiter).map((c) => c.trim());
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
