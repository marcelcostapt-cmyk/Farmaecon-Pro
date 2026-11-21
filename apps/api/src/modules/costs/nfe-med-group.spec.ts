import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml } from './nfe-xml-parser';

// Grupo med (medicamentos) — leiaute oficial (XSD): cProdANVISA 11 ou 13 dígitos ou ISENTO;
// xMotivoIsencao opcional (1 a 255); vPMC TDec_1302. Injeta-se no fixture sintético.
const base = readFileSync(join(__dirname, '../../../test/fixtures/nfe-belajoyce.xml'), 'utf8');

function withMed(): string {
  const edits: Array<[string, string]> = [
    [
      '<rastro><nLote>L1</nLote><qLote>250</qLote></rastro></prod>',
      '<rastro><nLote>L1</nLote><qLote>250</qLote></rastro><med><cProdANVISA>0123456789012</cProdANVISA><vPMC>25.90</vPMC></med></prod>',
    ],
    [
      '<rastro><nLote>L2</nLote><qLote>1</qLote></rastro></prod>',
      '<rastro><nLote>L2</nLote><qLote>1</qLote></rastro><med><cProdANVISA>ISENTO</cProdANVISA><xMotivoIsencao>RDC 1234/2020</xMotivoIsencao><vPMC>10</vPMC></med></prod>',
    ],
    [
      '<rastro><nLote>L4</nLote><qLote>681</qLote></rastro></prod>',
      '<rastro><nLote>L4</nLote><qLote>681</qLote></rastro><med><cProdANVISA>12345</cProdANVISA><vPMC>abc</vPMC></med></prod>',
    ],
  ];
  let xml = base;
  for (const [from, to] of edits) {
    if (!xml.includes(from)) throw new Error(`fixture sem o trecho esperado: ${from}`);
    xml = xml.replace(from, to);
  }
  return xml;
}

describe('grupo med (medicamentos) no parser de NF-e', () => {
  const inv = parseNfeXml(withMed());
  const line = (n: string) => inv.lines.find((l) => l.lineNumber === n)!;

  it('lê cProdANVISA como texto (preserva zero à esquerda) e vPMC como decimal', () => {
    expect(line('1').anvisaRegister).toBe('0123456789012');
    expect(line('1').pmc?.toString()).toBe('25.9');
    expect(line('1').anvisaExemptionReason).toBeNull();
  });

  it('medicamento isento: ISENTO com xMotivoIsencao', () => {
    expect(line('2').anvisaRegister).toBe('ISENTO');
    expect(line('2').anvisaExemptionReason).toBe('RDC 1234/2020');
    expect(line('2').pmc?.toString()).toBe('10');
  });

  it('valor fora do XSD não é gravado, e gera aviso', () => {
    expect(line('4').anvisaRegister).toBeNull();
    expect(line('4').pmc).toBeNull();
    expect(line('4').warnings.some((w) => /cProdANVISA inválido/.test(w))).toBe(true);
    expect(line('4').warnings.some((w) => /vPMC inválido/.test(w))).toBe(true);
  });

  it('linha sem grupo med: campos nulos e sem avisos de medicamento', () => {
    expect(line('3').anvisaRegister).toBeNull();
    expect(line('3').anvisaExemptionReason).toBeNull();
    expect(line('3').pmc).toBeNull();
    expect(line('3').warnings.some((w) => /ANVISA|vPMC/.test(w))).toBe(false);
  });
});
