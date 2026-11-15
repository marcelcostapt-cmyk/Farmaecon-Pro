import { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, type UnifiedInvoice } from '../costs/document-parser';
import { parsePdfText } from '../costs/nfe-pdf-parser';
import { buildCostPoolFromInvoice } from '../costs/cmv-preview';
import { computeOrderCmvPreview, type PreviewOrderItem } from '../costs/cmv-preview';
import { computeDrePreview, type DreOrderRow } from '../costs/dre-preview';
import { DEFAULT_STRATEGY, type CostPoolEntry } from '../costs/cost-matching';

const dir = join(__dirname, '../../../test/fixtures');
const D = (v: string) => new Prisma.Decimal(v);
const money = (d: Prisma.Decimal | null) => (d === null ? 'indisponível' : `R$ ${d.toFixed(4)}`);

// Constrói um UnifiedInvoice de PDF a partir do parse real do texto (custo rastreável).
function pdfUnified(): UnifiedInvoice {
  const nf = parsePdfText(readFileSync(join(dir, 'danfe-luciana.txt'), 'utf8'));
  return {
    source: 'pdf', originalFilename: 'danfe-luciana.pdf', fileHashSha256: 'a'.repeat(64),
    invoiceNumber: nf.invoiceNumber, invoiceSeries: nf.invoiceSeries, invoiceKey: null,
    issuerCnpj: null, recipientCnpj: null, issuedAt: nf.issuedAt,
    productsTotal: nf.productsTotal, otherExpenses: nf.otherExpenses, discounts: null,
    documentTotal: nf.documentTotal, fiscalTotal: nf.documentTotal, paymentAmountInDocument: null,
    hasBonus: false, bonusAmount: null, paidAmount: null, bonusCalculations: [],
    warnings: nf.warnings,
    lines: nf.lines.map((l) => ({
      lineNumber: l.lineNumber, sourceRef: `linha ${l.lineNumber}`,
      supplierProductCode: l.supplierProductCode, ean: l.ean, marketplaceSku: l.marketplaceSku, description: l.description,
      ncm: null, unit: null, quantity: l.quantity, unitCostExtracted: l.unitCostExtracted, unitCostPaid: l.unitCostExtracted,
      totalLine: l.totalLine, discount: null, otherExpense: null, cfop: null, lotNumber: l.lot,
      isBonus: false, approvedAcquisitionCost: null, warnings: l.warnings,
    })),
  };
}

async function xlsxUnified(): Promise<UnifiedInvoice> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('ML GERAL');
  ws.getCell('A1').value = 'EAN'; ws.getCell('B1').value = 'Produto'; ws.getCell('C1').value = 'Custo';
  ws.getCell('A2').value = '7899999999999'; ws.getCell('B2').value = 'PRODUTO PLANILHA'; ws.getCell('C2').value = 25.0;
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return parseDocument('DRE_referencia.xlsx', buf);
}

describe('VALIDAÇÃO DA DRE — conta de ensaio (fixtures sanitizadas; originais reais PENDENTES)', () => {
  it('cruza pedido×custo pelas 3 fontes, mostra origem por SKU, pendências sem assumir zero, e DRE', async () => {
    // ---- Acervo de custos (pending_review) das 3 fontes ----
    const xml = await parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml')));
    const pdf = pdfUnified();
    const xlsx = await xlsxUnified();
    const pool: CostPoolEntry[] = [
      ...buildCostPoolFromInvoice(xml),
      ...buildCostPoolFromInvoice(pdf),
      ...buildCostPoolFromInvoice(xlsx),
    ];

    // ---- Pedido ML de ensaio (order_items não têm EAN → casa por SKU/descrição) ----
    const soldAt = new Date('2026-11-20');
    const items: Array<PreviewOrderItem & { saleFee: Prisma.Decimal }> = [
      { lineId: 'i1', ean: null, marketplaceSku: null, description: 'PRODUTO A', quantity: D('2'), revenue: D('80.00'), soldAt, saleFee: D('9.60') },
      { lineId: 'i2', ean: null, marketplaceSku: null, description: 'PRODUTO PLANILHA', quantity: D('3'), revenue: D('150.00'), soldAt, saleFee: D('18.00') },
      { lineId: 'i3', ean: null, marketplaceSku: null, description: 'PRODUTO INEXISTENTE', quantity: D('1'), revenue: D('50.00'), soldAt, saleFee: D('6.00') },
    ];

    const cmv = computeOrderCmvPreview('ORDER-ENSAIO', items, pool, DEFAULT_STRATEGY);

    // ---- RELATÓRIO: origem do custo por SKU ----
    const linhas: string[] = [];
    linhas.push('\n===== VALIDAÇÃO DA DRE (modo preview — nada publicado) =====');
    linhas.push('Fonte dos custos: NF-e 1926966 (XML), DANFE 2325345 (PDF), DRE_referencia.xlsx (planilha).');
    linhas.push('\n--- Origem do custo por SKU ---');
    for (const it of cmv.items) {
      const c0 = it.cost_candidates[0];
      const origem = c0 ? `${c0.source_type.toUpperCase()} ${c0.source_document} · linha ${c0.source_line} · ${c0.source_hash.slice(0, 16)}…` : '—';
      linhas.push(`• ${it.description}: ${it.cost_status.toUpperCase()} | custo ${it.cost_candidates.length} cand. | origem: ${origem}`);
      if (it.cost_candidates.length > 1)
        for (const c of it.cost_candidates) linhas.push(`     ↳ ${c.rule_key}: ${money(c.unit_cost)}/un`);
      if (it.warnings.length) linhas.push(`     ⚠ ${it.warnings.join(' | ')}`);
    }

    // ---- Custo pendente no acervo que NÃO cruza com pedidos ML (origem documentada) ----
    const pdfOnly = pool.find((e) => e.supplierCode === '5080' && e.ean === null);

    // ---- DRE da conta ----
    const rows: DreOrderRow[] = items.map((i) => ({
      accountId: 'conta-ensaio', date: soldAt, ean: null, marketplaceSku: null, description: i.description,
      quantity: i.quantity, revenue: i.revenue,
    }));
    const dre = computeDrePreview(rows, pool, DEFAULT_STRATEGY, 'product');
    const taxasTotal = items.reduce((s, i) => s.plus(i.saleFee), D('0'));

    linhas.push('\n--- DRE indicativo da conta (diferenças: receita × custo × taxas × margem) ---');
    linhas.push(`Receita total:            R$ ${dre.summary.receita_total.toFixed(2)}`);
    linhas.push(`CMV estimado (min..max):  R$ ${dre.summary.cmv_total_estimado_min?.toFixed(2) ?? '—'} .. R$ ${dre.summary.cmv_total_estimado_max?.toFixed(2) ?? '—'}`);
    linhas.push(`CMV indicativo (final):   ${dre.summary.cmv_total_indicativo === null ? 'null (ambíguo/indisponível)' : 'R$ ' + dre.summary.cmv_total_indicativo.toFixed(2)}`);
    linhas.push(`Taxas ML (order_items.sale_fee): R$ ${taxasTotal.toFixed(2)}  ⚠ NÃO entram no DRE preview (gap)`);
    linhas.push(`Lucro bruto:              ${dre.summary.lucro_bruto === null ? 'null (depende de custo aprovado + taxas)' : 'R$ ' + dre.summary.lucro_bruto.toFixed(2)}`);
    linhas.push(`Margem bruta:             ${dre.summary.margem_bruta === null ? 'null' : dre.summary.margem_bruta.toFixed(2) + '%'}`);
    linhas.push(`Itens: ${dre.summary.itens_estimados} estimados · ${dre.summary.itens_indisponiveis} indisponíveis · ${dre.summary.itens_aprovados} aprovados`);

    linhas.push('\n--- PENDÊNCIAS (custos ausentes registrados; NENHUM assumido como zero) ---');
    linhas.push('P1. PRODUTO INEXISTENTE: sem custo no acervo → cost_status=unavailable, cmv=null (não zero).');
    linhas.push(`P2. PDF código 5080 (${money(pdfOnly?.candidates[0].unitCost ?? null)}): sem EAN/SKU → não cruza com pedidos ML (decisões #5/#6). ${pdfOnly?.warnings?.[0] ?? ''}`);
    linhas.push('P3. Bonificação (NF-e 1926966, EAN ...996): 3 regras candidatas, decisão #2 pendente → sem custo único.');
    linhas.push('P4. Taxas ML: order_items.sale_fee existe mas o DRE preview não as agrega; financial_transactions=0 por design.');
    linhas.push('P5. Validação byte-a-byte: XML/PDF/planilha REAIS da conta ausentes no disco → validado com fixtures sintéticas.');
    // eslint-disable-next-line no-console
    console.log(linhas.join('\n'));

    // ---- ASSERÇÕES de validação ----
    const prodA = cmv.items.find((i) => i.description === 'PRODUTO A')!;
    expect(prodA.cost_status).toBe('estimated');
    expect(prodA.cmv_indicativo!.equals(D('33.14'))).toBe(true); // 16.57 × 2, origem XML
    expect(prodA.cost_candidates[0].source_document).toBe('NF-e 1926966');
    expect(prodA.cost_candidates[0].source_hash).toMatch(/^sha256:[0-9a-f]{64}$/);

    const planilha = cmv.items.find((i) => i.description === 'PRODUTO PLANILHA')!;
    expect(planilha.cost_status).toBe('estimated');
    expect(planilha.cost_candidates[0].source_type).toBe('xlsx');
    expect(planilha.cmv_indicativo!.equals(D('75.00'))).toBe(true); // 25 × 3

    const inexistente = cmv.items.find((i) => i.description === 'PRODUTO INEXISTENTE')!;
    expect(inexistente.cost_status).toBe('unavailable');
    expect(inexistente.cmv_indicativo).toBeNull(); // NUNCA zero

    // DRE: custo indicativo final é null (há item indisponível) → margem null, sem número final enganoso
    expect(dre.summary.cmv_total_indicativo).toBeNull();
    expect(dre.summary.margem_bruta).toBeNull();
    expect(dre.summary.itens_indisponiveis).toBe(1);

    // PDF com custo mas sem vínculo a pedido ML, e com aviso de outras despesas
    expect(pdfOnly).toBeDefined();
    expect(pdfOnly!.warnings!.some((w) => /outras despesas/i.test(w))).toBe(true);
  });
});
