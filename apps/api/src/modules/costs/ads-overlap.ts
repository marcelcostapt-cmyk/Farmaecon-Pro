import { Prisma } from '@prisma/client';
import type { AdsRow } from './ads-csv';

// Sobreposição de despesas de ADS entre um ficheiro novo e linhas JÁ importadas de OUTROS ficheiros.
// Função pura. Correspondência 1 para 1 (multiconjunto): cada linha existente só pode coincidir com
// uma linha do ficheiro novo. Nada é eliminado: linhas com valores iguais podem ser despesas legítimas.
// A decisão de importar é do ADMIN (confirmação explícita, validada no servidor).

export interface ExistingAdsLine {
  line: number;
  day: string; // AAAA-MM-DD
  sku: string | null;
  campaign: string | null;
  amount: Prisma.Decimal;
  sourceHash: string;
}

export interface OverlapMatch {
  newLine: number;
  existingLine: number;
  existingBatch: string; // primeiros 12 caracteres do hash do ficheiro já importado
  day: string;
  sku: string | null;
  campaign: string | null;
  amount: string;
}

export interface OverlapResult {
  count: number;
  amount: string; // soma das linhas do ficheiro novo que coincidem
  matches: OverlapMatch[];
}

export const OVERLAP_SAMPLE_SIZE = 20;

function keyOf(day: string, sku: string | null, campaign: string | null, amount: Prisma.Decimal): string {
  return JSON.stringify([day, sku, campaign, amount.toFixed(4)]);
}

export function findOverlap(newRows: AdsRow[], existing: ExistingAdsLine[]): OverlapResult {
  const pool = new Map<string, ExistingAdsLine[]>();
  for (const e of existing) {
    const k = keyOf(e.day, e.sku, e.campaign, e.amount);
    const list = pool.get(k) ?? [];
    list.push(e);
    pool.set(k, list);
  }
  const matches: OverlapMatch[] = [];
  let amount = new Prisma.Decimal(0);
  for (const r of newRows) {
    const k = keyOf(r.day, r.sku, r.campaign, r.amount);
    const candidates = pool.get(k);
    if (!candidates || candidates.length === 0) continue;
    const e = candidates.shift()!;
    amount = amount.plus(r.amount);
    matches.push({
      newLine: r.line,
      existingLine: e.line,
      existingBatch: e.sourceHash.slice(0, 12),
      day: r.day,
      sku: r.sku,
      campaign: r.campaign,
      amount: r.amount.toFixed(2),
    });
  }
  return { count: matches.length, amount: amount.toFixed(2), matches };
}
