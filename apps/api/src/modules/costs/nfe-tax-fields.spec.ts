import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml } from './nfe-xml-parser';

// IPI (vIPI) e ICMS-ST (vICMSST) por linha, lidos de qualquer nível de det/imposto.
const base = readFileSync(join(__dirname, '../../../test/fixtures/nfe-belajoyce.xml'), 'utf8');

describe('impostos por linha (IPI e ICMS-ST) no parser de NF-e', () => {
  it('lê vIPI e vICMSST quando presentes, e fica null quando ausentes', () => {
    const from = '<imposto><IBS><vIBS>0.00</vIBS></IBS></imposto><vItem>13.46</vItem>';
    expect(base.includes(from)).toBe(true);
    const xml = base.replace(
      from,
      '<imposto><IPI><IPITrib><vIPI>3.00</vIPI></IPITrib></IPI><ICMS><ICMS60><vICMSST>2.50</vICMSST></ICMS60></ICMS><IBS><vIBS>0.00</vIBS></IBS></imposto><vItem>13.46</vItem>',
    );
    const inv = parseNfeXml(xml);
    const line2 = inv.lines.find((l) => l.lineNumber === '2')!;
    expect(line2.ipi?.toString()).toBe('3');
    expect(line2.icmsSt?.toString()).toBe('2.5');
    const line1 = inv.lines.find((l) => l.lineNumber === '1')!;
    expect(line1.ipi).toBeNull();
    expect(line1.icmsSt).toBeNull();
  });
});
