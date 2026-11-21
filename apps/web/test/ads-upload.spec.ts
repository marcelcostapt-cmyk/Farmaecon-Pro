import { ADS_MAX_BYTES, ADS_MAX_ROWS, formatBrl, formatDateBr, percentOf, validateCsvFile } from '../src/lib/ads-upload';

describe('import de ADS — validação no navegador', () => {
  it('aceita CSV dentro do limite', () => {
    expect(validateCsvFile({ name: 'campanhas.CSV', size: 1000 })).toBeNull();
  });

  it('recusa extensão que não é .csv', () => {
    expect(validateCsvFile({ name: 'planilha.xlsx', size: 10 })).toMatch(/extensão .csv/);
  });

  it('recusa ficheiro vazio', () => {
    expect(validateCsvFile({ name: 'a.csv', size: 0 })).toMatch(/vazio/);
  });

  it('recusa ficheiro acima de 2 MB, com o tamanho real', () => {
    expect(ADS_MAX_BYTES).toBe(2 * 1024 * 1024);
    expect(validateCsvFile({ name: 'a.csv', size: ADS_MAX_BYTES + 1 })).toMatch(/limite é 2 MB/);
    expect(validateCsvFile({ name: 'a.csv', size: ADS_MAX_BYTES })).toBeNull();
  });

  it('limite de linhas declarado igual ao do servidor', () => {
    expect(ADS_MAX_ROWS).toBe(20000);
  });
});

describe('apresentação de valores e datas', () => {
  it('reais em formato brasileiro', () => {
    expect(formatBrl('170.00')).toMatch(/R\$\s?170,00/);
    expect(formatBrl('1234.5')).toMatch(/R\$\s?1\.234,50/);
  });

  it('sem valor é indisponível, nunca zero', () => {
    expect(formatBrl(null)).toBe('indisponível');
    expect(formatBrl('')).toBe('indisponível');
  });

  it('datas ISO viram DD/MM/AAAA sem deslocar o dia', () => {
    expect(formatDateBr('2026-11-10')).toBe('10/11/2026');
    expect(formatDateBr(null)).toBe('—');
  });

  it('percentagem com total zero não divide por zero', () => {
    expect(percentOf('20', '170')).toBe('11.8%');
    expect(percentOf('20', '0')).toBe('—');
  });
});
