import { normalizeCnpj, isValidCnpj, normalizeBusinessName } from './cnpj';

describe('normalizeCnpj', () => {
  it('remove só máscara e espaços previstos, preserva letras e zeros, maiúsculas', () => {
    // NÃO usar \D: letras são válidas no CNPJ alfanumérico.
    expect(normalizeCnpj('12.ABC.345/01DE-35')).toBe('12ABC34501DE35');
    expect(normalizeCnpj(' 12abc34501de35 ')).toBe('12ABC34501DE35');
    expect(normalizeCnpj('00.000.000/0001-91')).toBe('00000000000191'); // zeros iniciais preservados
  });
  it('vazio/nulo → null', () => {
    expect(normalizeCnpj('')).toBeNull();
    expect(normalizeCnpj(null)).toBeNull();
    expect(normalizeCnpj('   ')).toBeNull();
  });
});

describe('isValidCnpj', () => {
  it('aceita CNPJ numérico válido, com e sem máscara', () => {
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
  });
  it('rejeita DV numérico trocado', () => {
    expect(isValidCnpj('11222333000182')).toBe(false);
  });
  it('aceita o exemplo oficial RFB alfanumérico (Anexo XV)', () => {
    expect(isValidCnpj('12ABC34501DE35')).toBe(true);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
  });
  it('rejeita DV alfanumérico trocado', () => {
    expect(isValidCnpj('12ABC34501DE34')).toBe(false);
  });
  it('contar 14 caracteres não basta: DV inválido é rejeitado', () => {
    expect(isValidCnpj('12345678901234')).toBe(false);
  });
  it('rejeita comprimento errado ou caracteres inválidos', () => {
    expect(isValidCnpj('1122233300018')).toBe(false); // 13
    expect(isValidCnpj('11222333000181X')).toBe(false); // 15
    expect(isValidCnpj('12ABC34501DE3@')).toBe(false); // char inválido
  });
});

describe('normalizeBusinessName', () => {
  it('remove acentos, pontuação e sufixos societários; maiúsculas; preserva o núcleo', () => {
    expect(normalizeBusinessName('Drogaria Belajoyce LTDA-ME')).toBe('DROGARIA BELAJOYCE');
    expect(normalizeBusinessName('Cimed & Co. S/A')).toBe('CIMED CO');
    expect(normalizeBusinessName('Maxifarmá Distribuidora EIRELI')).toBe('MAXIFARMA DISTRIBUIDORA');
  });
  it('vazio → null', () => {
    expect(normalizeBusinessName('')).toBeNull();
    expect(normalizeBusinessName(null)).toBeNull();
  });
});
