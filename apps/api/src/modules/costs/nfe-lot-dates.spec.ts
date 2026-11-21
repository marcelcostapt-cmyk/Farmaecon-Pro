import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument } from './document-parser';

// Validade/fabricação do lote (NF-e rastro dVal/dFab). O fixture não as traz: injetam-se em memória.
const base = readFileSync(join(__dirname, '../../../test/fixtures/nfe-belajoyce.xml'), 'utf8');

function withDates(): string {
  const edits: Array<[string, string]> = [
    // linha 1: lote único com datas válidas
    [
      '<rastro><nLote>L1</nLote><qLote>250</qLote></rastro>',
      '<rastro><nLote>L1</nLote><qLote>250</qLote><dFab>2026-01-10</dFab><dVal>2027-01-10</dVal></rastro>',
    ],
    // linha 2: lote único com data em formato inválido → nunca inventar
    ['<rastro><nLote>L2</nLote><qLote>1</qLote></rastro>', '<rastro><nLote>L2</nLote><qLote>1</qLote><dVal>10/01/2027</dVal></rastro>'],
    // linha 3: dois lotes; um deles com data → validade NÃO persistida (multi-lote)
    [
      '<rastro><nLote>L3A</nLote><qLote>58</qLote></rastro>',
      '<rastro><nLote>L3A</nLote><qLote>58</qLote><dVal>2027-03-01</dVal></rastro>',
    ],
  ];
  let xml = base;
  for (const [from, to] of edits) {
    if (!xml.includes(from)) throw new Error(`fixture sem o trecho esperado: ${from}`);
    xml = xml.replace(from, to);
  }
  return xml;
}

describe('validade e fabricação do lote na NF-e', () => {
  it('lote único com datas válidas: extrai dVal e dFab (AAAA-MM-DD)', async () => {
    const doc = await parseDocument('nfe.xml', Buffer.from(withDates()));
    const line = doc.lines.find((l) => l.lineNumber === '1')!;
    expect(line.lotNumber).toBe('L1');
    expect(line.expiryDate).toBe('2027-01-10');
    expect(line.fabricationDate).toBe('2026-01-10');
  });

  it('data fora do formato AAAA-MM-DD fica null (nunca se inventa uma data)', async () => {
    const doc = await parseDocument('nfe.xml', Buffer.from(withDates()));
    const line = doc.lines.find((l) => l.lineNumber === '2')!;
    expect(line.lotNumber).toBe('L2');
    expect(line.expiryDate).toBeNull();
    expect(line.fabricationDate).toBeNull();
  });

  it('multi-lote: validade e fabricação não persistidas, com aviso explícito', async () => {
    const doc = await parseDocument('nfe.xml', Buffer.from(withDates()));
    const line = doc.lines.find((l) => l.lineNumber === '3')!;
    expect(line.lotNumber).toBe('L3A+L3B');
    expect(line.expiryDate).toBeNull();
    expect(line.fabricationDate).toBeNull();
    expect(line.warnings.some((w) => /validade\/fabricação por lote não persistidas/.test(w))).toBe(true);
  });

  it('linhas sem rastro não trazem datas', async () => {
    const doc = await parseDocument('nfe.xml', Buffer.from(base));
    for (const line of doc.lines) {
      expect(line.expiryDate).toBeNull();
      expect(line.fabricationDate).toBeNull();
    }
  });
});
