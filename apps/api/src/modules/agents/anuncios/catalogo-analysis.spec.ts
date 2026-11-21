import { Prisma } from '@prisma/client';
import { analyseCatalogo, CATALOGO_BLOCK_REASONS, CATALOGO_RULES, type CatalogoInput, type CatalogoProduct } from './catalogo-analysis';

const D = (v: string) => new Prisma.Decimal(v);
const prod = (over: Partial<CatalogoProduct> & { sku: string }): CatalogoProduct => ({
  title: 'Produto de teste completo',
  basePrice: 50,
  stockQuantity: 10,
  minStockQuantity: 2,
  anvisaRegister: 'REG-1',
  ...over,
});

function input(over: Partial<CatalogoInput> = {}): CatalogoInput {
  return {
    account: { id: 'acc-1', name: 'Conta 1', status: 'ACTIVE' },
    sold: [{ sku: 'A', units: 3 }],
    products: [prod({ sku: 'A' })],
    costs: [{ sku: 'A', unitCost: D('20') }],
    ...over,
  };
}

const ids = (r: ReturnType<typeof analyseCatalogo>) => r.findings.map((f) => f.id);

describe('Anúncios — bloqueios', () => {
  it('conta desligada não é analisada', () => {
    const r = analyseCatalogo(input({ account: { id: 'acc-1', name: 'C', status: 'DISCONNECTED' } }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(CATALOGO_BLOCK_REASONS.ACCOUNT_DISCONNECTED);
    expect(r.summary.skusVendidos).toBe(0);
  });

  it('conta sem vendas: BLOCKED SEM_VENDAS, sem achados', () => {
    const r = analyseCatalogo(input({ sold: [] }));
    expect(r.status).toBe('BLOCKED');
    expect(r.blockReason).toBe(CATALOGO_BLOCK_REASONS.NO_SALES);
    expect(r.findings).toEqual([]);
  });
});

describe('Anúncios — qualidade do catálogo (regras explícitas)', () => {
  it('produto completo, com custo e margem: sem pendências nem riscos', () => {
    const r = analyseCatalogo(input());
    expect(r.status).toBe('COMPLETED');
    expect(r.findings.filter((f) => f.severity !== 'info')).toEqual([]);
    expect(r.summary).toMatchObject({ skusVendidos: 1, comCadastro: 1, semCadastro: 0, comCustoAprovado: 1, unidadesVendidas: 3 });
  });

  it('SKU vendido sem cadastro vira pendência com a lista de exemplo', () => {
    const r = analyseCatalogo(input({ sold: [{ sku: 'A', units: 1 }, { sku: 'X', units: 2 }] }));
    expect(ids(r)).toContain('sem-cadastro');
    expect(r.findings.find((f) => f.id === 'sem-cadastro')?.evidence).toMatchObject({ skus: ['X'], total: 1 });
    expect(r.summary.semCadastro).toBe(1);
  });

  it(`título com menos de ${CATALOGO_RULES.MIN_TITLE_LENGTH} caracteres é incompleto`, () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', title: '  curto ' })] }));
    expect(r.findings.find((f) => f.id === 'titulo-incompleto')?.severity).toBe('pendencia');
  });

  it('títulos iguais em SKUs diferentes (sem diferença de caixa/espaço) são duplicados', () => {
    const r = analyseCatalogo(input({
      sold: [{ sku: 'A', units: 1 }, { sku: 'B', units: 1 }],
      products: [prod({ sku: 'A', title: 'Dipirona Sódica 500mg' }), prod({ sku: 'B', title: 'dipirona   sódica 500mg' })],
      costs: [{ sku: 'A', unitCost: D('10') }, { sku: 'B', unitCost: D('10') }],
    }));
    expect(r.findings.find((f) => f.id === 'titulo-duplicado')?.evidence).toMatchObject({ total: 2 });
  });

  it('sem registo Anvisa é pendência, sem aplicar a regra automaticamente', () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', anvisaRegister: null })] }));
    const f = r.findings.find((x) => x.id === 'anvisa-ausente');
    expect(f?.severity).toBe('pendencia');
    expect(f?.detail).toMatch(/Verificar se a categoria exige/);
  });

  it('preço-base zero ou negativo é risco', () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 0 })], costs: [] }));
    expect(r.findings.find((f) => f.id === 'preco-invalido')?.severity).toBe('risco');
  });

  it('venda com estoque zero é risco de ruptura', () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', stockQuantity: 0 })] }));
    expect(r.findings.find((f) => f.id === 'ruptura-com-venda')?.severity).toBe('risco');
  });

  it('estoque abaixo do mínimo é risco; mínimo zero não é avaliado', () => {
    expect(ids(analyseCatalogo(input({ products: [prod({ sku: 'A', stockQuantity: 1, minStockQuantity: 2 })] })))).toContain('estoque-abaixo-minimo');
    expect(ids(analyseCatalogo(input({ products: [prod({ sku: 'A', stockQuantity: 0, minStockQuantity: 0 })], sold: [{ sku: 'A', units: 0 }] })))).not.toContain('estoque-abaixo-minimo');
  });

  it('SKU vendido sem custo publicado aprovado é pendência (não se usa cost_price)', () => {
    const r = analyseCatalogo(input({ costs: [] }));
    expect(r.findings.find((f) => f.id === 'sem-custo-publicado')?.severity).toBe('pendencia');
    expect(r.summary.comCustoAprovado).toBe(0);
  });

  it('preço-base abaixo do custo publicado aprovado é risco individual com as duas cifras', () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 15 })], costs: [{ sku: 'A', unitCost: D('20') }] }));
    const f = r.findings.find((x) => x.id === 'preco-abaixo-custo-1');
    expect(f?.severity).toBe('risco');
    expect(f?.evidence).toMatchObject({ sku: 'A', precoBase: '15.00', custoAprovado: '20.00' });
    expect(r.recommendations.map((x) => x.text).join(' ')).toMatch(/Rever o preço-base do SKU A/);
  });

  it('oportunidade só com margem ≥ limite e estoque ≥ 3x mínimo; é informativa e limitada a cinco', () => {
    const boa = analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 100, stockQuantity: 9, minStockQuantity: 2 })], costs: [{ sku: 'A', unitCost: D('50') }] }));
    expect(boa.findings.find((f) => f.id === 'oportunidade-1')?.severity).toBe('info');
    const fraca = analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 100, stockQuantity: 5, minStockQuantity: 2 })], costs: [{ sku: 'A', unitCost: D('50') }] }));
    expect(fraca.findings.some((f) => f.id.startsWith('oportunidade'))).toBe(false);
  });

  it('nenhuma recomendação de ação sobre anúncios, preços ou promoções sem base de achado', () => {
    const r = analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 15 })] }));
    for (const rec of r.recommendations) expect(rec.basedOn.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.recommendations)).not.toMatch(/alterar automaticamente|pausar anúncio|aplicar promoção/i);
  });

  it('caveats declaram catálogo local, Buy Box não avaliado e leitura apenas', () => {
    const text = analyseCatalogo(input()).caveats.join(' ');
    expect(text).toMatch(/CATÁLOGO LOCAL/);
    expect(text).toMatch(/Buy Box não é avaliado/);
    expect(text).toMatch(/não altera anúncios/);
  });

  it('nenhum NaN ou Infinity no resultado', () => {
    expect(JSON.stringify(analyseCatalogo(input({ products: [prod({ sku: 'A', basePrice: 0, minStockQuantity: 0 })], costs: [{ sku: 'A', unitCost: D('0') }] })))).not.toMatch(/NaN|Infinity/);
  });
});
