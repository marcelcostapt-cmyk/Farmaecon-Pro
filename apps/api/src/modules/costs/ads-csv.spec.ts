import { ADS_MAX_BYTES, ADS_MAX_ROWS, parseAdsCsv, splitCsvLine, summarizeAdsRows } from './ads-csv';

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

  describe('campos entre aspas e caracteres especiais', () => {
    it('campanha entre aspas pode conter o delimitador ; sem quebrar a linha', () => {
      const r = parseAdsCsv('data;valor;campanha\n2026-11-10;10,00;"Black; Friday"\n');
      expect(r.errors).toEqual([]);
      expect(r.rows[0].campaign).toBe('Black; Friday');
    });

    it('campanha com vírgula entre aspas no delimitador vírgula', () => {
      const r = parseAdsCsv('data,valor,campanha\n2026-11-10,10.00,"Oferta, dia 1"\n');
      expect(r.rows[0].campaign).toBe('Oferta, dia 1');
      expect(r.rows[0].amount.toString()).toBe('10');
    });

    it('aspa dupla dentro do campo entre aspas é escapada ("")', () => {
      const r = parseAdsCsv('data;valor;campanha\n2026-11-10;1;"Promo ""Verão"""\n');
      expect(r.rows[0].campaign).toBe('Promo "Verão"');
    });

    it('cabeçalho com nome entre aspas e delimitador ; dentro de aspas não confunde a deteção', () => {
      const r = parseAdsCsv('"data";"valor";"nota; interna"\n2026-11-10;5;x\n');
      expect(r.errors).toEqual([]);
      expect(r.rows[0].amount.toString()).toBe('5');
    });

    it('aspas não fechadas são recusadas com a linha, sem inventar campos', () => {
      const r = parseAdsCsv('data;valor;campanha\n2026-11-10;1;"Sem fecho\n');
      expect(r.rows).toEqual([]);
      expect(r.errors[0]).toMatch(/Linha 2: aspas não fechadas/);
    });

    it('texto colado depois de campo entre aspas é recusado', () => {
      const r = parseAdsCsv('data;valor;campanha\n2026-11-10;1;"A"B\n');
      expect(r.errors[0]).toMatch(/texto depois de campo entre aspas/);
    });

    it('aspas no meio de campo não entre aspas são tratadas como texto literal', () => {
      const r = parseAdsCsv('data;valor;campanha\n2026-11-10;1;Promo "X"\n');
      expect(r.rows[0].campaign).toBe('Promo "X"');
    });

    it('BOM UTF-8, CRLF e acentos são aceites', () => {
      const r = parseAdsCsv('\uFEFFdata;valor;campanha\r\n2026-11-10;2,50;Verão ação\r\n');
      expect(r.errors).toEqual([]);
      expect(r.rows[0].campaign).toBe('Verão ação');
    });

    it('campo vazio entre delimitadores não quebra a linha', () => {
      const r = parseAdsCsv('data;valor;sku;campanha\n2026-11-10;3;;C1\n');
      expect(r.rows[0]).toMatchObject({ sku: null, campaign: 'C1' });
    });
  });

  describe('splitCsvLine', () => {
    it('divide campos simples e preserva campos vazios finais', () => {
      expect(splitCsvLine('a;b;', ';')).toEqual({ cells: ['a', 'b', ''], error: null });
    });
  });

  describe('limites e resumo', () => {
    it('constantes de limite explícitas: 2 MB e 20 000 linhas', () => {
      expect(ADS_MAX_BYTES).toBe(2 * 1024 * 1024);
      expect(ADS_MAX_ROWS).toBe(20000);
    });

    it('recusa ficheiro acima do máximo de linhas', () => {
      const body = Array.from({ length: ADS_MAX_ROWS + 1 }, () => '2026-11-10;1').join('\n');
      expect(parseAdsCsv(`data;valor\n${body}`).errors[0]).toMatch(/Máximo de 20000 linhas/);
    });

    it('resumo de pré-visualização: período, total, sem SKU e distribuição', () => {
      const r = parseAdsCsv('data;valor;sku;campanha\n2026-11-11;20;;C2\n2026-11-10;30;A;C1\n2026-11-10;50;A;C1\n');
      const sum = summarizeAdsRows(r.rows);
      expect(sum).toMatchObject({ rows: 3, firstDay: '2026-11-10', lastDay: '2026-11-11' });
      expect(sum.total.toString()).toBe('100');
      expect(sum.unallocated.toString()).toBe('20');
      expect(sum.bySku[0]).toMatchObject({ sku: 'A' });
      expect(sum.bySku[0].amount.toString()).toBe('80');
    });

    it('resumo de lista vazia não inventa período nem total', () => {
      expect(summarizeAdsRows([])).toMatchObject({ rows: 0, firstDay: null, lastDay: null });
      expect(summarizeAdsRows([]).total.toString()).toBe('0');
    });
  });
});
