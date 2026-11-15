import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { parseCostsWorkbook } from './excel-cost-parser';

async function planilhaSintetica(): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  const geral = wb.addWorksheet('ML GERAL');
  geral.getCell('A1').value = 'EAN'; geral.getCell('B1').value = 'Produto'; geral.getCell('C1').value = 'Custo';
  geral.getCell('A2').value = { richText: [{ text: '7897947606517' }] } as never; // texto
  geral.getCell('A2').value = '7897947606517'; geral.getCell('B2').value = 'PRODUTO A'; geral.getCell('C2').value = 16.57;
  geral.getCell('A3').value = '40141957603'; geral.getCell('B3').value = 'PRODUTO B'; geral.getCell('C3').value = 10; // 11 dígitos
  geral.getCell('A4').value = ''; geral.getCell('B4').value = ''; geral.getCell('C4').value = ''; // vazia -> ignorar
  geral.getCell('A5').value = '123'; geral.getCell('B5').value = ''; geral.getCell('C5').value = 5; // sem descrição -> ignorar
  const abril = wb.addWorksheet('ABRIL 2026');
  abril.getCell('C49').value = 'dd'; abril.getCell('D49').value = 20; // quantidade inválida
  abril.getCell('C2').value = 3; abril.getCell('D2').value = 15.5; // referência válida
  return wb;
}

describe('parseCostsWorkbook — planilha de custos', () => {
  it('importa só ML GERAL como custos; preserva EAN de 11 dígitos como texto; ignora linhas incompletas', async () => {
    const res = parseCostsWorkbook(await planilhaSintetica());
    expect(res.source).toBe('xlsx');
    expect(res.costRows).toHaveLength(2);
    expect(res.costRows.map((r) => r.ean)).toEqual(['7897947606517', '40141957603']);
    expect(res.costRows[1].ean).toBe('40141957603'); // não vira notação científica
    expect(res.costRows[0].unitCost!.equals(new Prisma.Decimal('16.57'))).toBe(true);
    expect(res.costRows[0].sheet).toBe('ML GERAL');
    expect(res.costRows[0].validFrom).toBeNull();
  });

  it('abas mensais entram só como referência histórica; quantidade "dd" é rejeitada com warning, nunca zero', async () => {
    const res = parseCostsWorkbook(await planilhaSintetica());
    expect(res.costRows.every((r) => r.sheet === 'ML GERAL')).toBe(true); // mensais não viram custo
    const ddRow = res.historicalRows.find((r) => r.sourceCell === 'C49');
    expect(ddRow).toBeDefined();
    expect(ddRow!.quantity).toBeNull(); // não convertida em 0
    expect(ddRow!.warnings.some((w) => /Quantidade inválida/i.test(w))).toBe(true);
  });
});
