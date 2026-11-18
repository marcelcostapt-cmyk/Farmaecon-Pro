import { invoiceBusinessKey, normalizeCnpj } from './invoice-key';
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
    const inv = base({ invoiceKey: '35261111222333000181550010000123451000000018', invoiceNumber: '1926966' });
    expect(invoiceBusinessKey(inv)).toBe('chave:35261111222333000181550010000123451000000018');
  });

  it('dois documentos com a mesma chave produzem a mesma business key (dedup)', () => {
    const CHAVE = '35261111222333000181550010000123451000000018'; // sintética, DV válido
    const a = base({ invoiceKey: CHAVE, originalFilename: 'Belajoyce.xml' });
    const b = base({ invoiceKey: CHAVE, originalFilename: 'NFE-352611.xml' });
    expect(invoiceBusinessKey(a)).toBe(invoiceBusinessKey(b));
  });

  it('chave presente mas com DV inválido NÃO é usada para dedup (cai na composição)', () => {
    // último dígito trocado (8→9) → DV inválido; usa número+emitente em vez de dedup por chave ambígua
    const inv = base({ invoiceKey: '35261111222333000181550010000123451000000019', invoiceNumber: '12345', issuerCnpj: '11222333000181', issuedAt: new Date('2026-11-02T00:00:00Z') });
    expect(invoiceBusinessKey(inv)).toBe('nf:12345:0:11222333000181::2026-11-02');
  });

  it('sem chave, compõe nf:numero:serie:emitente:destinatario:data (CNPJ normalizado)', () => {
    const inv = base({
      invoiceNumber: '82322',
      invoiceSeries: '004',
      issuerCnpj: '02.543.945/0003-47', // formatado → só dígitos
      recipientCnpj: '54000000000000',
      issuedAt: new Date('2026-10-28T12:00:00Z'),
    });
    expect(invoiceBusinessKey(inv)).toBe('nf:82322:004:02543945000347:54000000000000:2026-10-28');
  });

  it('sem chave e sem data usa o literal "sem-data" (não "undefined")', () => {
    const inv = base({ invoiceNumber: '999', invoiceSeries: '1', issuerCnpj: '11111111000111', recipientCnpj: '22222222000122', issuedAt: null });
    expect(invoiceBusinessKey(inv)).toBe('nf:999:1:11111111000111:22222222000122:sem-data');
  });

  it('série ausente assume "0"', () => {
    const inv = base({ invoiceNumber: '55', invoiceSeries: null, issuerCnpj: '11111111000111', issuedAt: new Date('2026-01-02T00:00:00Z') });
    expect(invoiceBusinessKey(inv)).toBe('nf:55:0:11111111000111::2026-01-02');
  });

  it('sem chave, sem número ou sem emitente → lança (recusa chave fraca)', () => {
    expect(() => invoiceBusinessKey(base({ invoiceNumber: null, issuerCnpj: '11111111000111' }))).toThrow(/dados mínimos/);
    expect(() => invoiceBusinessKey(base({ invoiceNumber: '55', issuerCnpj: null }))).toThrow(/dados mínimos/);
  });

  it('normalizeCnpj remove formatação e trata nulo/indefinido', () => {
    expect(normalizeCnpj('02.543.945/0003-47')).toBe('02543945000347');
    expect(normalizeCnpj(null)).toBe('');
    expect(normalizeCnpj(undefined)).toBe('');
  });
});
