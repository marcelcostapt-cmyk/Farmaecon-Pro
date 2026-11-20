import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { money } from './cost-money';

export interface ParsedCostRow {
  source: 'xlsx';
  sheet: string;
  sourceCell: string;
  ean: string | null;
  description: string | null;
  unitCost: Prisma.Decimal | null;
  validFrom: Date | null; // nulo até a vigência ser definida
  mlProductId: string | null; // nulo até o vínculo ser confirmado
  warnings: string[];
}
export interface ParsedHistoricalRow {
  sheet: string;
  sourceCell: string;
  quantity: Prisma.Decimal | null;
  unitCost: Prisma.Decimal | null;
  warnings: string[];
}
export interface ParsedCostsResult {
  source: 'xlsx';
  costRows: ParsedCostRow[];
  historicalRows: ParsedHistoricalRow[];
  warnings: string[];
}

const COST_SHEET = 'ML GERAL';

// Texto da célula preservando identificadores (EAN) como string, sem notação científica.
function cellStr(cell: ExcelJS.Cell): string | null {
  const v = cell.value as unknown;
  if (v == null || v === '') return null;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as Array<{ text: string }>).map((t) => t.text).join('').trim() || null;
    if ('text' in o) return String(o.text).trim() || null;
    if ('result' in o) return String(o.result);
    if ('error' in o) return null;
  }
  if (typeof v === 'number') return String(v);
  return String(v).trim() || null;
}

// Converte uma célula num Decimal; sinaliza erro/valor não numérico em vez de assumir zero.
function cellNum(cell: ExcelJS.Cell): { value: Prisma.Decimal | null; error: 'ERRO_FORMULA' | 'NAO_NUMERICO' | null } {
  const v = cell.value as unknown;
  if (v == null || v === '') return { value: null, error: null };
  if (typeof v === 'number' && Number.isFinite(v)) return { value: money(String(v)), error: null };
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('error' in o) return { value: null, error: 'ERRO_FORMULA' };
    if ('result' in o && typeof o.result === 'number') return { value: money(String(o.result)), error: null };
  }
  const s = String(v).trim().replace(/\./g, '').replace(',', '.');
  if (/^-?\d+(\.\d+)?$/.test(s)) return { value: money(s), error: null };
  return { value: null, error: 'NAO_NUMERICO' };
}

export function parseCostsWorkbook(wb: ExcelJS.Workbook): ParsedCostsResult {
  const costRows: ParsedCostRow[] = [];
  const historicalRows: ParsedHistoricalRow[] = [];
  const warnings: string[] = [];

  const geral = wb.getWorksheet(COST_SHEET);
  if (!geral) warnings.push(`Aba "${COST_SHEET}" não encontrada; nenhum custo importado`);
  else {
    const fim = Math.min(geral.rowCount, 68);
    for (let r = 2; r <= fim; r++) {
      const row = geral.getRow(r);
      const ean = cellStr(row.getCell(1)); // A = identificador informado como EAN
      const description = cellStr(row.getCell(2)); // B = descrição
      if (!ean || !description) continue; // ignora linhas sem identificador ou descrição
      const custo = cellNum(row.getCell(3)); // C = custo unitário
      const w: string[] = [];
      if (custo.error) w.push(`Custo inválido na célula C${r} (${custo.error}); linha mantida sem custo`);
      costRows.push({ source: 'xlsx', sheet: COST_SHEET, sourceCell: `A${r}`, ean, description, unitCost: custo.value, validFrom: null, mlProductId: null, warnings: w });
    }
  }

  // Abas mensais: só referência histórica (C = quantidade, D = custo unitário). Nunca viram custo oficial.
  for (const ws of wb.worksheets) {
    if (ws.name === COST_SHEET) continue;
    for (let r = 2; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const qtd = cellNum(row.getCell(3));
      const custo = cellNum(row.getCell(4));
      if (qtd.value === null && custo.value === null && !qtd.error && !custo.error) continue;
      const w: string[] = [];
      if (qtd.error) w.push(`Quantidade inválida na célula C${r}, linha rejeitada`);
      if (custo.error) w.push(`Custo inválido na célula D${r} (${custo.error})`);
      historicalRows.push({ sheet: ws.name, sourceCell: `C${r}`, quantity: qtd.value, unitCost: custo.value, warnings: w });
    }
  }
  return { source: 'xlsx', costRows, historicalRows, warnings };
}

export async function parseCostsSpreadsheet(buffer: Buffer): Promise<ParsedCostsResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  return parseCostsWorkbook(wb);
}
