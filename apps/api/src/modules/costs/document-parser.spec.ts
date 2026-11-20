import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import { parseDocument, sha256 } from './document-parser';

const fixtures = join(__dirname, '../../../test/fixtures');

async function planilhaBuffer(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const geral = wb.addWorksheet('ML GERAL');
  geral.getCell('A1').value = 'EAN'; geral.getCell('B1').value = 'Produto'; geral.getCell('C1').value = 'Custo';
  geral.getCell('A2').value = '7897947606517'; geral.getCell('B2').value = 'PRODUTO A'; geral.getCell('C2').value = 16.57;
  geral.getCell('A3').value = '40141957603'; geral.getCell('B3').value = 'PRODUTO B'; geral.getCell('C3').value = 10;
  const abril = wb.addWorksheet('ABRIL 2026');
  abril.getCell('C49').value = 'dd'; abril.getCell('D49').value = 20;
  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab);
}

describe('parseDocument — saída normalizada única com hash e rastreabilidade', () => {
  it('rejeita formato não suportado', async () => {
    await expect(parseDocument('conta.txt', Buffer.from('x'))).rejects.toThrow(/não suportado/i);
  });

  it('XML: normaliza cabeçalho, 4 linhas, sourceRef por linha e hash sha256 do ficheiro', async () => {
    const buf = readFileSync(join(fixtures, 'nfe-belajoyce.xml'));
    const doc = await parseDocument('NFe_Belajoyce_1926966.xml', buf);
    expect(doc.source).toBe('xml');
    expect(doc.originalFilename).toBe('NFe_Belajoyce_1926966.xml');
    expect(doc.fileHashSha256).toBe(sha256(buf));
    expect(doc.fileHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.invoiceNumber).toBe('1926966');
    expect(doc.lines).toHaveLength(4);
    expect(doc.lines[0].sourceRef).toBe('det[1]');
    expect(doc.lines.every((l) => l.approvedAcquisitionCost === null)).toBe(true);
    // linha 4 sem vItem mantém o total de produtos (vProd 8315.01)
    expect(doc.lines[3].totalLine!.toString()).toBe('8315.01');
    // linha 3 tem dois lotes → lotNumber combinado + warning
    expect(doc.lines[2].lotNumber).toContain('+');
    expect(doc.lines[2].warnings.some((w) => /lotes/i.test(w))).toBe(true);
  });

  it('XLSX: normaliza catálogo ML GERAL em linhas com sourceRef aba!célula e EAN texto', async () => {
    const buf = await planilhaBuffer();
    const doc = await parseDocument('DRE_MERCADO_LIVRE.xlsx', buf);
    expect(doc.source).toBe('xlsx');
    expect(doc.fileHashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(doc.lines).toHaveLength(2);
    expect(doc.lines[0].ean).toBe('7897947606517');
    expect(doc.lines[0].sourceRef).toBe('ML GERAL!A2');
    expect(doc.lines[0].unitCostExtracted!.toString()).toBe('16.57');
    expect(doc.lines[1].ean).toBe('40141957603'); // 11 dígitos, não vira notação científica
    expect(doc.invoiceNumber).toBeNull();
  });

  it('hash é determinístico para o mesmo conteúdo e difere com 1 byte alterado', () => {
    const a = Buffer.from('conteudo fiscal');
    const b = Buffer.from('conteudo fiscaL');
    expect(sha256(a)).toBe(sha256(a));
    expect(sha256(a)).not.toBe(sha256(b));
  });
});
