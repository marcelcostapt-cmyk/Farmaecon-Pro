import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseNfeXml } from '../costs/nfe-xml-parser';
import { parsePdfText } from '../costs/nfe-pdf-parser';
import { computeBonusCalculations } from '../costs/bonus-calc';
import { parseDocument, type UnifiedInvoice } from '../costs/document-parser';
import { buildCostPoolFromInvoice, computeOrderCmvPreview, type PreviewOrderItem } from '../costs/cmv-preview';
import { computeDrePreview, type DreOrderRow } from '../costs/dre-preview';
import { DEFAULT_STRATEGY, type CostPoolEntry } from '../costs/cost-matching';

const dir = join(__dirname, '../../../test/fixtures');
const D = (v: string) => new Prisma.Decimal(v);
const parseX = (f: string) => parseNfeXml(readFileSync(join(dir, `nfe-${f}.xml`)));
const diff = (a: Prisma.Decimal | null, ref: string) => (a === null ? 'AUSENTE' : a.minus(D(ref)).toFixed(2));
const out: string[] = [];

describe('VALIDAÇÃO DA DRE — conta (fixtures sanitizadas; originais reais AUSENTES no disco)', () => {
  it('1) PARSER × VALORES DE REFERÊNCIA DO CATÁLOGO (todos os 10 documentos) — Δ deve ser 0,00', () => {
    // Referência = valores documentados pelo usuário no catálogo, em test/fixtures/dre-valores-referencia.json.
    // Os documentos são as NF-e fornecidas, sanitizadas conforme instrução do usuário.
    const refJson: { documentos: Record<string, { productsTotal?: string; fiscalTotal?: string; discounts?: string; otherExpenses?: string; itens?: number }> } =
      JSON.parse(readFileSync(join(dir, 'dre-valores-referencia.json'), 'utf8'));
    out.push('\n===== VALIDAÇÃO DA DRE (preview — nada publicado) =====');
    out.push('\n[1] Reconciliação parser × referência do catálogo (Δ = calculado − referência), 10 documentos:');
    out.push('  NF           itens  Δ vProd  Δ vNF   Δ vDesc  Δ vOutro');
    for (const [file, r] of Object.entries(refJson.documentos)) {
      const inv = parseNfeXml(readFileSync(join(dir, file)));
      if (r.itens !== undefined) expect(inv.lines).toHaveLength(r.itens);
      if (r.productsTotal) expect(diff(inv.productsTotal, r.productsTotal)).toBe('0.00');
      if (r.fiscalTotal) expect(diff(inv.fiscalTotal, r.fiscalTotal)).toBe('0.00');
      if (r.discounts) expect(diff(inv.discounts, r.discounts)).toBe('0.00');
      if (r.otherExpenses) expect(diff(inv.otherExpenses, r.otherExpenses)).toBe('0.00');
      out.push(
        `  ${(inv.invoiceNumber ?? file).padEnd(12)} ${String(inv.lines.length).padStart(3)}    ${(r.productsTotal ? diff(inv.productsTotal, r.productsTotal) : '—').padStart(6)}   ${(r.fiscalTotal ? diff(inv.fiscalTotal, r.fiscalTotal) : '—').padStart(5)}   ${(r.discounts ? diff(inv.discounts, r.discounts) : '—').padStart(6)}   ${(r.otherExpenses ? diff(inv.otherExpenses, r.otherExpenses) : '—').padStart(6)}`,
      );
    }

    // Belajoyce (NF 1926966): bonificação — fatura 8315.96, bonus 8315.01
    const bel = parseX('belajoyce');
    expect(diff(bel.paymentAmountInDocument, '8315.96')).toBe('0.00');
    expect(diff(bel.bonusAmount, '8315.01')).toBe('0.00');
    out.push(`  1926966 (bonif.)   fatura Δ ${diff(bel.paymentAmountInDocument, '8315.96')}  bonus Δ ${diff(bel.bonusAmount, '8315.01')}`);

    // PDF Luciana: referência total 6012.93, 376 un, custo médio condicional 15.991835
    const pdf = parsePdfText(readFileSync(join(dir, 'danfe-luciana.txt'), 'utf8'));
    const un = pdf.lines.reduce((s, l) => s.plus(l.quantity), D('0'));
    expect(diff(pdf.documentTotal, '6012.93')).toBe('0.00');
    expect(un.equals(D('376'))).toBe(true);
    expect(pdf.conditionalAverageCost!.toFixed(6)).toBe('15.991835');
    out.push(`  PDF 2325345  —   total Δ ${diff(pdf.documentTotal, '6012.93')}  un=${un}  custo médio condicional=${pdf.conditionalAverageCost!.toFixed(6)} (ref 15.991835)`);
  });

  it('2) MARGEM/LUCRO por cenário de bonificação (decisão #2) — números concretos, com taxas', () => {
    // Cenário de venda do SKU bonificado (NF 1926966, EAN ...996): preço e taxa ML por unidade.
    const precoUnit = D('45.00');
    const taxaML = precoUnit.times(D('0.13')); // 13% comissão ML (exemplo)
    const bonus = computeBonusCalculations(parseX('belajoyce')).find((b) => b.ean === '7897947607996')!;

    out.push('\n[2] Margem por cenário da bonificação — venda 1 un a R$ 45,00, taxa ML 13% (R$ 5,85):');
    out.push('  regra                               custo/un   lucro/un   margem');
    const margens: Record<string, Prisma.Decimal | null> = {};
    for (const c of bonus.candidates) {
      if (c.unitCost === null) {
        out.push(`  ${c.rule.padEnd(35)} indisponível   —          —`);
        margens[c.rule] = null;
        continue;
      }
      const lucro = precoUnit.minus(c.unitCost).minus(taxaML);
      const margem = lucro.div(precoUnit).times(100);
      margens[c.rule] = margem;
      out.push(`  ${c.rule.padEnd(35)} ${c.unitCost.toFixed(4).padStart(9)}   ${lucro.toFixed(2).padStart(7)}   ${margem.toFixed(2)}%`);
    }
    // A diferença de margem entre os cenários é o impacto da decisão #2 ainda pendente.
    const maxM = margens['bonificacao_dilui_custo']!;
    const minM = margens['bonificacao_sem_custo']!;
    out.push(`  → Spread de margem entre cenários: ${maxM.minus(minM).toFixed(2)} pontos percentuais (impacto da decisão #2 pendente).`);

    expect(margens['rateio_proporcional_valor_nominal']).not.toBeNull();
    expect(maxM.gt(minM)).toBe(true); // diluir custo dá a maior margem; sem-custo a menor
  });

  it('3) CRUZAMENTO pedido×custo + DRE indicativo + pendências (sem assumir zero)', async () => {
    const xml = await parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml')));
    const pdfU = pdfUnified();
    const xlsxU = await xlsxUnified();
    const pool: CostPoolEntry[] = [...buildCostPoolFromInvoice(xml), ...buildCostPoolFromInvoice(pdfU), ...buildCostPoolFromInvoice(xlsxU)];

    const soldAt = new Date('2026-11-20');
    const items: Array<PreviewOrderItem & { saleFee: Prisma.Decimal }> = [
      { lineId: 'i1', ean: null, marketplaceSku: null, description: 'PRODUTO A', quantity: D('2'), revenue: D('80.00'), soldAt, saleFee: D('10.40') },
      { lineId: 'i2', ean: null, marketplaceSku: null, description: 'PRODUTO PLANILHA', quantity: D('3'), revenue: D('150.00'), soldAt, saleFee: D('19.50') },
      { lineId: 'i3', ean: null, marketplaceSku: null, description: 'PRODUTO INEXISTENTE', quantity: D('1'), revenue: D('50.00'), soldAt, saleFee: D('6.50') },
    ];
    const cmv = computeOrderCmvPreview('ORDER-ENSAIO', items, pool, DEFAULT_STRATEGY);

    out.push('\n[3] Origem do custo por SKU (documento · linha · hash):');
    for (const it of cmv.items) {
      const c0 = it.cost_candidates[0];
      const origem = c0 ? `${c0.source_type.toUpperCase()} ${c0.source_document} · linha ${c0.source_line} · ${c0.source_hash.slice(0, 16)}…` : '—';
      out.push(`  • ${it.description}: ${it.cost_status.toUpperCase()} | ${origem}`);
    }

    const rows: DreOrderRow[] = items.map((i) => ({ accountId: 'conta-ensaio', date: soldAt, ean: null, marketplaceSku: null, description: i.description, quantity: i.quantity, revenue: i.revenue }));
    const dre = computeDrePreview(rows, pool, DEFAULT_STRATEGY, 'product');
    const taxas = items.reduce((s, i) => s.plus(i.saleFee), D('0'));
    // Lucro bruto indicativo PARCIAL: só sobre itens com custo estimado único + taxas desses itens.
    const matched = cmv.items.filter((i) => i.cmv_indicativo !== null);
    const recMatched = matched.reduce((s, i) => s.plus(i.revenue), D('0'));
    const cmvMatched = matched.reduce((s, i) => s.plus(i.cmv_indicativo!), D('0'));
    const feesMatched = items.filter((i) => matched.some((m) => m.line_id === i.lineId)).reduce((s, i) => s.plus(i.saleFee), D('0'));
    const lucroParcial = recMatched.minus(cmvMatched).minus(feesMatched);
    const margemParcial = lucroParcial.div(recMatched).times(100);

    out.push('\n[3] DRE indicativo (receita × custo × taxas × margem):');
    out.push(`  Receita total:           R$ ${dre.summary.receita_total.toFixed(2)}`);
    out.push(`  CMV estimado (min..max): R$ ${dre.summary.cmv_total_estimado_min?.toFixed(2)} .. R$ ${dre.summary.cmv_total_estimado_max?.toFixed(2)}`);
    out.push(`  CMV indicativo (final):  null (1 item indisponível → não emito total enganoso)`);
    out.push(`  Taxas ML (sale_fee):     R$ ${taxas.toFixed(2)}  ⚠ não agregadas pelo DRE preview (gap)`);
    out.push(`  Margem/lucro FINAL:      null (custo pendente + taxas não agregadas)`);
    out.push(`  Margem/lucro PARCIAL (só itens casados, c/ taxas): lucro R$ ${lucroParcial.toFixed(2)} · margem ${margemParcial.toFixed(2)}% (receita casada R$ ${recMatched.toFixed(2)})`);

    out.push('\n[PENDÊNCIAS — custos ausentes registrados; NENHUM assumido como zero]');
    out.push('  P1. PRODUTO INEXISTENTE: sem custo no acervo → unavailable, cmv=null (não zero).');
    out.push('  P2. PDF código 5080: sem EAN/SKU → não cruza com pedidos ML (dec. #5/#6); outras despesas R$ 2,49 pendentes.');
    out.push('  P3. Bonificação (EAN ...996): 3 regras candidatas (dec. #2) → spread de margem relevante (ver bloco 2).');
    out.push('  P4. Taxas ML: existem em order_items.sale_fee mas o DRE preview não as agrega; financial_transactions=0 por design.');
    out.push('  P5. Documentos REAIS da conta ausentes no disco → reconciliei contra os valores do catálogo, não byte-a-byte.');
    // eslint-disable-next-line no-console
    console.log(out.join('\n'));

    expect(cmv.items.find((i) => i.description === 'PRODUTO INEXISTENTE')!.cmv_indicativo).toBeNull();
    expect(dre.summary.margem_bruta).toBeNull();
    expect(margemParcial.gt(D('0'))).toBe(true); // número de margem concreto existe para os itens casados
  });
});

// --- helpers de fonte (custos rastreáveis) ---
function pdfUnified(): UnifiedInvoice {
  const nf = parsePdfText(readFileSync(join(dir, 'danfe-luciana.txt'), 'utf8'));
  return {
    extractionIncomplete: false,
    source: 'pdf', originalFilename: 'danfe-luciana.pdf', fileHashSha256: 'a'.repeat(64),
    invoiceNumber: nf.invoiceNumber, invoiceSeries: nf.invoiceSeries, invoiceKey: null,
    issuerCnpj: null, recipientCnpj: null, issuedAt: nf.issuedAt,
    productsTotal: nf.productsTotal, otherExpenses: nf.otherExpenses, discounts: null,
    documentTotal: nf.documentTotal, fiscalTotal: nf.documentTotal, paymentAmountInDocument: null,
    hasBonus: false, bonusAmount: null, paidAmount: null, bonusCalculations: [], warnings: nf.warnings,
    lines: nf.lines.map((l) => ({
      lineNumber: l.lineNumber, sourceRef: `linha ${l.lineNumber}`, supplierProductCode: l.supplierProductCode,
      ean: l.ean, marketplaceSku: l.marketplaceSku, description: l.description, ncm: null, unit: null,
      quantity: l.quantity, unitCostExtracted: l.unitCostExtracted, unitCostPaid: l.unitCostExtracted, totalLine: l.totalLine,
      discount: null, otherExpense: null, cfop: null, lotNumber: l.lot, fabricationDate: null, expiryDate: null, anvisaRegister: null, anvisaExemptionReason: null, pmc: null,
      isBonus: false, approvedAcquisitionCost: null, warnings: l.warnings,
    })),
  };
}

async function xlsxUnified(): Promise<UnifiedInvoice> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ML GERAL');
  ws.getCell('A1').value = 'EAN'; ws.getCell('B1').value = 'Produto'; ws.getCell('C1').value = 'Custo';
  ws.getCell('A2').value = '7899999999999'; ws.getCell('B2').value = 'PRODUTO PLANILHA'; ws.getCell('C2').value = 25.0;
  return parseDocument('DRE_referencia.xlsx', Buffer.from(await wb.xlsx.writeBuffer()));
}
