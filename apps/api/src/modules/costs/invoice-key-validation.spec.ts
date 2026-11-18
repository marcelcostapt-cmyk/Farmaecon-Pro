import {
  invoiceKeyCheckDigit,
  validateInvoiceKey,
  provisionalInvoiceIdentity,
  parseInvoiceKeyParts,
} from './invoice-key-validation';

// Chave SINTÉTICA com CNPJ fictício 11222333000181 e DV mod-11 correto (8).
// UF 35 · AAMM 2611 · CNPJ 11222333000181 · modelo 55 · série 001 · número 000012345 · tpEmis 1 · cNF 00000001 · DV 8
const CHAVE_VALIDA = '35261111222333000181550010000123451000000018';

describe('invoiceKeyCheckDigit (mod-11)', () => {
  it('calcula o dígito verificador dos primeiros 43 dígitos', () => {
    expect(invoiceKeyCheckDigit(CHAVE_VALIDA.slice(0, 43))).toBe(8);
  });
});

describe('parseInvoiceKeyParts', () => {
  it('decompõe a chave de 44 dígitos nos campos fiscais', () => {
    const p = parseInvoiceKeyParts(CHAVE_VALIDA)!;
    expect(p).toMatchObject({ uf: '35', aamm: '2611', cnpj: '11222333000181', modelo: '55', serie: '001', numero: '000012345', dv: '8' });
  });
  it('devolve null se não tiver 44 dígitos', () => {
    expect(parseInvoiceKeyParts('123')).toBeNull();
  });
});

describe('validateInvoiceKey', () => {
  it('chave válida: estrutura ok, sem conflitos, sem revisão', () => {
    const v = validateInvoiceKey(CHAVE_VALIDA);
    expect(v).toMatchObject({ present: true, lengthOk: true, checkDigitOk: true, valid: true, conflicts: [], requiresReview: false });
  });

  it('tolera formatação com espaços/pontos (trata como texto)', () => {
    expect(validateInvoiceKey('3526 1111 2223 3300 0181 5500 1000 0123 4510 0000 0018').valid).toBe(true);
  });

  it('DV inválido → não é válida e exige revisão (comprimento certo não prova autenticidade)', () => {
    const v = validateInvoiceKey('35261111222333000181550010000123451000000019'); // DV 9 errado
    expect(v.lengthOk).toBe(true);
    expect(v.checkDigitOk).toBe(false);
    expect(v.valid).toBe(false);
    expect(v.requiresReview).toBe(true);
  });

  it('comprimento errado → inválida e revisão', () => {
    expect(validateInvoiceKey('123')).toMatchObject({ lengthOk: false, valid: false, requiresReview: true });
  });

  it('ausente → não presente, sem revisão por si (segue para identidade provisória)', () => {
    expect(validateInvoiceKey(null)).toMatchObject({ present: false, valid: false, requiresReview: false });
  });

  it('campos identificadores batem → sem conflito', () => {
    const v = validateInvoiceKey(CHAVE_VALIDA, {
      issuerCnpj: '11.222.333/0001-81', modelo: '55', serie: '1', numero: '12345', issuedAt: new Date('2026-11-05T00:00:00Z'),
    });
    expect(v.conflicts).toEqual([]);
    expect(v.requiresReview).toBe(false);
  });

  it('conflito de CNPJ entre chave e emitente → revisão', () => {
    const v = validateInvoiceKey(CHAVE_VALIDA, { issuerCnpj: '99999999000199' });
    expect(v.conflicts).toContain('cnpj');
    expect(v.requiresReview).toBe(true);
  });
});

describe('provisionalInvoiceIdentity', () => {
  it('compõe identidade provisória a partir de emitente/modelo/série/número/data', () => {
    expect(provisionalInvoiceIdentity({ issuerCnpj: '11.222.333/0001-81', modelo: '55', serie: '1', numero: '12345', issuedAt: new Date('2026-11-05T00:00:00Z') }))
      .toBe('provisorio:11222333000181:55:1:12345:2026-11-05');
  });

  it('sem emitente ou sem número → null (não inventa identidade)', () => {
    expect(provisionalInvoiceIdentity({ numero: '12345' })).toBeNull();
    expect(provisionalInvoiceIdentity({ issuerCnpj: '11222333000181' })).toBeNull();
  });
});
