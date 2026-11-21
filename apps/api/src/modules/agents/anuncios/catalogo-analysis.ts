import { Prisma } from '@prisma/client';

// ANÚNCIOS (agente público; identificação interna Vitrine Farma). Análise determinística da QUALIDADE
// DO CATÁLOGO LOCAL (cadastro `products`) para os SKUs vendidos pela conta. Função PURA.
// Não é o anúncio publicado no Mercado Livre: não há chamada ao ML nem escopo novo. Não altera nada.
// Custos: só custos APROVADOS (product_costs), nunca o campo legado products.cost_price.

export const CATALOGO_BLOCK_REASONS = {
  ACCOUNT_DISCONNECTED: 'CONTA_DESCONECTADA',
  NO_SALES: 'SEM_VENDAS',
} as const;
export type CatalogoBlockReason = (typeof CATALOGO_BLOCK_REASONS)[keyof typeof CATALOGO_BLOCK_REASONS];

/** Parâmetros explícitos das regras (verificáveis no código). */
export const CATALOGO_RULES = {
  MIN_TITLE_LENGTH: 10, // título com menos caracteres é considerado incompleto
  OPPORTUNITY_MARGIN_PCT: 40, // margem bruta sobre o preço-base, com custo aprovado
  OPPORTUNITY_STOCK_MULTIPLIER: 3, // estoque de pelo menos 3x o mínimo
  SAMPLE_SIZE: 20, // SKUs listados como exemplo em cada achado agregado
} as const;

export interface CatalogoProduct {
  sku: string;
  title: string;
  basePrice: number; // preço-base do cadastro
  stockQuantity: number;
  minStockQuantity: number;
  anvisaRegister: string | null;
}

export interface CatalogoInput {
  account: { id: string; name: string; status: 'ACTIVE' | 'WARNING' | 'DISCONNECTED' };
  sold: Array<{ sku: string; units: number }>; // unidades vendidas por SKU na conta
  products: CatalogoProduct[]; // cadastro do tenant para os SKUs vendidos
  costs: Array<{ sku: string; unitCost: Prisma.Decimal }>; // custos APROVADOS da conta
}

export type CatalogoSeverity = 'risco' | 'pendencia' | 'info';

export interface CatalogoFinding {
  id: string;
  severity: CatalogoSeverity;
  title: string;
  detail: string;
  evidence: Record<string, string | number | string[] | null>;
}

export interface CatalogoResult {
  agentKey: 'vitrine-farma';
  account: { id: string; name: string };
  status: 'COMPLETED' | 'BLOCKED';
  blockReason: CatalogoBlockReason | null;
  summary: { skusVendidos: number; comCadastro: number; semCadastro: number; comCustoAprovado: number; unidadesVendidas: number };
  findings: CatalogoFinding[];
  recommendations: Array<{ text: string; basedOn: string[] }>;
  sources: Array<{ name: string; description: string; count: number }>;
  caveats: string[];
}

export const CATALOGO_CAVEATS: string[] = [
  'Análise do CATÁLOGO LOCAL (cadastro do utilizador), não do anúncio publicado no Mercado Livre.',
  'Buy Box não é avaliado: depende de API oficial ainda não confirmada.',
  'Análise de leitura: não altera anúncios, títulos, preços, promoções nem estoque.',
];

const normalizeTitle = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
const pct = (part: Prisma.Decimal, total: Prisma.Decimal) => (total.isZero() ? null : part.div(total).mul(100));

export function analyseCatalogo(input: CatalogoInput): CatalogoResult {
  const { account, sold, products, costs } = input;
  const unidades = sold.reduce((s, x) => s + x.units, 0);
  const sources = [
    { name: 'order_items (conta)', description: 'SKUs vendidos pela conta, com unidades', count: sold.length },
    { name: 'products (cadastro do tenant)', description: 'Cadastro dos SKUs vendidos', count: products.length },
    { name: 'product_costs APPROVED (conta)', description: 'Custos publicados e aprovados', count: costs.length },
  ];
  const base = { agentKey: 'vitrine-farma' as const, account: { id: account.id, name: account.name }, sources, caveats: CATALOGO_CAVEATS };

  if (account.status === 'DISCONNECTED') {
    return { ...base, status: 'BLOCKED', blockReason: CATALOGO_BLOCK_REASONS.ACCOUNT_DISCONNECTED, summary: zero(unidades), findings: [], recommendations: [] };
  }
  if (sold.length === 0) {
    return { ...base, status: 'BLOCKED', blockReason: CATALOGO_BLOCK_REASONS.NO_SALES, summary: zero(unidades), findings: [], recommendations: [] };
  }

  const bySku = new Map(products.map((p) => [p.sku, p]));
  const costBySku = new Map(costs.map((c) => [c.sku, c.unitCost]));
  const soldSkus = sold.map((s) => s.sku);
  const sample = (xs: string[]) => xs.slice(0, CATALOGO_RULES.SAMPLE_SIZE);
  const withProduct = soldSkus.filter((sku) => bySku.has(sku));
  const withoutProduct = soldSkus.filter((sku) => !bySku.has(sku));
  const withCost = soldSkus.filter((sku) => costBySku.has(sku));
  const findings: CatalogoFinding[] = [];
  const recs: CatalogoResult['recommendations'] = [];
  const add = (f: CatalogoFinding, text?: string) => {
    findings.push(f);
    if (text) recs.push({ text, basedOn: [f.id] });
  };

  if (withoutProduct.length > 0) {
    add(
      { id: 'sem-cadastro', severity: 'pendencia', title: `${withoutProduct.length} SKU(s) vendido(s) sem cadastro no catálogo`, detail: 'Sem cadastro não há título, preço-base nem estoque para avaliar.', evidence: { skus: sample(withoutProduct), total: withoutProduct.length } },
      'Cadastrar os SKUs vendidos que faltam no catálogo.',
    );
  }

  const incompleteTitle = withProduct.filter((sku) => bySku.get(sku)!.title.trim().length < CATALOGO_RULES.MIN_TITLE_LENGTH);
  if (incompleteTitle.length > 0) {
    add(
      { id: 'titulo-incompleto', severity: 'pendencia', title: `${incompleteTitle.length} produto(s) com título incompleto`, detail: `Título com menos de ${CATALOGO_RULES.MIN_TITLE_LENGTH} caracteres.`, evidence: { skus: sample(incompleteTitle), total: incompleteTitle.length, minimoCaracteres: CATALOGO_RULES.MIN_TITLE_LENGTH } },
      'Completar os títulos destes produtos no cadastro.',
    );
  }

  const seenTitles = new Map<string, string[]>();
  for (const sku of withProduct) {
    const k = normalizeTitle(bySku.get(sku)!.title);
    if (k.length === 0) continue;
    seenTitles.set(k, [...(seenTitles.get(k) ?? []), sku]);
  }
  const duplicated = [...seenTitles.values()].filter((list) => list.length > 1).flat();
  if (duplicated.length > 0) {
    add(
      { id: 'titulo-duplicado', severity: 'pendencia', title: `${duplicated.length} SKU(s) com título repetido`, detail: 'Títulos iguais em SKUs diferentes podem confundir o cliente e a análise.', evidence: { skus: sample(duplicated), total: duplicated.length } },
      'Diferenciar os títulos dos SKUs repetidos.',
    );
  }

  const noAnvisa = withProduct.filter((sku) => bySku.get(sku)!.anvisaRegister === null);
  if (noAnvisa.length > 0) {
    add(
      { id: 'anvisa-ausente', severity: 'pendencia', title: `${noAnvisa.length} produto(s) sem registo Anvisa no cadastro`, detail: 'Verificar se a categoria exige o registo. A regra não é aplicada automaticamente.', evidence: { skus: sample(noAnvisa), total: noAnvisa.length } },
      'Confirmar o registo Anvisa destes produtos quando a categoria exigir.',
    );
  }

  const invalidPrice = withProduct.filter((sku) => !(bySku.get(sku)!.basePrice > 0));
  if (invalidPrice.length > 0) {
    add(
      { id: 'preco-invalido', severity: 'risco', title: `${invalidPrice.length} produto(s) com preço-base inválido`, detail: 'Preço-base zero ou negativo impede qualquer análise de preço.', evidence: { skus: sample(invalidPrice), total: invalidPrice.length } },
      'Corrigir o preço-base destes produtos no cadastro.',
    );
  }

  const soldUnits = new Map(sold.map((s) => [s.sku, s.units]));
  const outOfStock = withProduct.filter((sku) => bySku.get(sku)!.stockQuantity === 0 && (soldUnits.get(sku) ?? 0) > 0);
  if (outOfStock.length > 0) {
    add(
      { id: 'ruptura-com-venda', severity: 'risco', title: `${outOfStock.length} SKU(s) sem estoque e com vendas na conta`, detail: 'Venda registada com estoque zero no cadastro. Verificar reposição.', evidence: { skus: sample(outOfStock), total: outOfStock.length } },
      'Verificar a reposição destes SKUs com venda recente.',
    );
  }

  const belowMin = withProduct.filter((sku) => {
    const p = bySku.get(sku)!;
    return p.minStockQuantity > 0 && p.stockQuantity < p.minStockQuantity;
  });
  if (belowMin.length > 0) {
    add(
      { id: 'estoque-abaixo-minimo', severity: 'risco', title: `${belowMin.length} SKU(s) com estoque abaixo do mínimo`, detail: 'Estoque do cadastro abaixo do mínimo configurado.', evidence: { skus: sample(belowMin), total: belowMin.length } },
      'Planear reposição dos SKUs abaixo do mínimo.',
    );
  }

  const semCusto = soldSkus.filter((sku) => !costBySku.has(sku));
  if (semCusto.length > 0) {
    add(
      { id: 'sem-custo-publicado', severity: 'pendencia', title: `${semCusto.length} SKU(s) vendido(s) sem custo publicado aprovado`, detail: 'Sem custo aprovado não é possível comparar preço e custo.', evidence: { skus: sample(semCusto), total: semCusto.length } },
      'Publicar o custo destes SKUs no fluxo de custos antes de avaliar o preço.',
    );
  }

  // Risco individual: preço-base abaixo do custo publicado aprovado.
  let index = 0;
  for (const sku of withProduct) {
    const cost = costBySku.get(sku);
    if (!cost) continue;
    const price = new Prisma.Decimal(bySku.get(sku)!.basePrice);
    if (price.greaterThan(0) && price.lessThan(cost)) {
      index += 1;
      const id = `preco-abaixo-custo-${index}`;
      add(
        { id, severity: 'risco', title: `SKU ${sku}: preço-base abaixo do custo publicado`, detail: `Preço-base R$ ${price.toFixed(2)} contra custo aprovado R$ ${cost.toFixed(2)}.`, evidence: { sku, precoBase: price.toFixed(2), custoAprovado: cost.toFixed(2) } },
        `Rever o preço-base do SKU ${sku}: está abaixo do custo publicado.`,
      );
    }
  }

  // Oportunidade (informativa): margem bruta alta e estoque confortável, ambas com dados existentes.
  let opp = 0;
  for (const sku of withProduct) {
    const cost = costBySku.get(sku);
    const p = bySku.get(sku)!;
    if (!cost || !(p.basePrice > 0) || !(p.minStockQuantity > 0)) continue;
    const margin = pct(new Prisma.Decimal(p.basePrice).minus(cost), new Prisma.Decimal(p.basePrice));
    if (margin === null || margin.lessThan(CATALOGO_RULES.OPPORTUNITY_MARGIN_PCT)) continue;
    if (p.stockQuantity < p.minStockQuantity * CATALOGO_RULES.OPPORTUNITY_STOCK_MULTIPLIER) continue;
    opp += 1;
    if (opp > 5) continue;
    findings.push({
      id: `oportunidade-${opp}`,
      severity: 'info',
      title: `SKU ${sku}: boa margem bruta com estoque confortável`,
      detail: `Margem bruta de ${margin.toFixed(1)}% sobre o preço-base, com estoque de ${p.stockQuantity} (mínimo ${p.minStockQuantity}). Candidato a destaque no anúncio; a decisão é humana.`,
      evidence: { sku, margemPercent: margin.toFixed(1), estoque: p.stockQuantity, minimo: p.minStockQuantity },
    });
  }

  return {
    ...base,
    status: 'COMPLETED',
    blockReason: null,
    summary: {
      skusVendidos: soldSkus.length,
      comCadastro: withProduct.length,
      semCadastro: withoutProduct.length,
      comCustoAprovado: withCost.length,
      unidadesVendidas: unidades,
    },
    findings,
    recommendations: recs,
  };
}

function zero(unidades: number) {
  return { skusVendidos: 0, comCadastro: 0, semCadastro: 0, comCustoAprovado: 0, unidadesVendidas: unidades };
}
