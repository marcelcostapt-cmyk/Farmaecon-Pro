import { parseAdsCsv } from './ads-csv';

describe('parseAdsCsv', () => {
  it('lê cabeçalho com ponto e vírgula, datas BR e ISO, e valores com vírgula decimal', () => {
    const r = parseAdsCsv('data;sku;campanha;valor\n10/11/2026;ABC;Black;1.234,56\n2026-11-11;;Geral;12,5\n');
    expect(r.errors).toEqual([]);
    expect(r.rows.map((x) => [x.day, x.sku, x.campaign, x.amount.toString()])).toEqual([
      ['2026-11-10', 'ABC', 'Black', '1234.56'],
      ['2026-11-11', null, 'Geral', '12.5'],
    ]);
  });

  it('aceita delimitador vírgula e valor com ponto decimal', () => {
    const r = parseAdsCsv('data,valor\n2026-11-10,99.90\n');
    expect(r.rows[0].amount.toString()).toBe('99.9');
  });

  it('recusa cabeçalho sem data/valor', () => {
    expect(parseAdsCsv('dia;total\n2026-11-10;1').errors[0]).toMatch(/data" e "valor/);
  });

  it('reporta linhas com data ou valor inválidos, com número da linha', () => {
    const r = parseAdsCsv('data;valor\n2026-02-30;10\n2026-11-10;abc\n2026-11-10;-5\n');
    expect(r.rows).toEqual([]);
    expect(r.errors).toHaveLength(3);
    expect(r.errors[0]).toMatch(/Linha 2: data inválida/);
    expect(r.errors[1]).toMatch(/Linha 3: valor inválido/);
    expect(r.errors[2]).toMatch(/Linha 4: valor inválido/);
  });

  it('ficheiro vazio é recusado', () => {
    expect(parseAdsCsv('\n  \n').errors).toEqual(['Ficheiro vazio.']);
  });
});
