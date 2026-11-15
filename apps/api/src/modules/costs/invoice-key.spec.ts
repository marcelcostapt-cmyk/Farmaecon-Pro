import { invoiceBusinessKey } from './invoice-key';
import type { UnifiedInvoice } from './document-parser';

// Base mínima; cada teste sobrepõe só o que interessa.
const base = (over: Partial<UnifiedInvoice>): UnifiedInvoice =>
  ({
    source: 'xml',
    originalFilename: 'x.xml',
    fileHashSha256: 'h',
    invoiceNumber: null,
    invoiceSeries: null,
    invoiceKey: null,
    issuerCnpj: null,
    recipientCnpj: null,
    issuedAt: null,
    productsTotal: null,
    fiscalTotal: null,
    discounts: null,
    otherExpenses: null,
    paymentAmountInDocument: null,
    hasBonus: false,
    bonusAmount: null,
    paidAmount: null,
    lines: [],
    warnings: [],
    ...over,
  }) as UnifiedInvoice;

describe('invoiceBusinessKey', () => {
  it('usa a chave de acesso quando presente (prefixo chave:)', () => {
    const inv = base({ invoiceKey: '35261116619378000108550200019269661800465907', invoiceNumber: '1926966' });
    expect(invoiceBusinessKey(inv)).toBe('chave:35261116619378000108550200019269661800465907');
  });

  it('dois documentos com a mesma chave produzem a mesma business key (dedup)', () => {
    const a = base({ invoiceKey: '352611...907'.padEnd(44, '0'), originalFilename: 'Belajoyce.xml' });
    const b = base({ invoiceKey: '352611...907'.padEnd(44, '0'), originalFilename: 'NFE-352611.xml' });
    expect(invoiceBusinessKey(a)).toBe(invoiceBusinessKey(b));
  });

  it('sem chave, compõe nf:numero:serie:emitente:destinatario:data', () => {
    const inv = base({
      invoiceNumber: '82322',
      invoiceSeries: '004',
      issuerCnpj: '02543945000347',
      recipientCnpj: '54000000000000',
      issuedAt: new Date('2026-10-28T12:00:00Z'),
    });
    expect(invoiceBusinessKey(inv)).toBe('nf:82322:004:02543945000347:54000000000000:2026-10-28');
  });

  it('sem chave e sem data não gera o literal "undefined" (data vazia)', () => {
    const inv = base({ invoiceNumber: '999', invoiceSeries: '1', issuerCnpj: 'A', recipientCnpj: 'B', issuedAt: null });
    expect(invoiceBusinessKey(inv)).toBe('nf:999:1:A:B:');
  });
});
