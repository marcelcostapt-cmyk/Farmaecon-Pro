import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseDocument, type UnifiedInvoice } from './document-parser';
import { buildCostPoolFromInvoice, computeOrderCmvPreview, type PreviewOrderItem } from './cmv-preview';
import { DEFAULT_STRATEGY } from './cost-matching';

const dir = join(__dirname, '../../../test/fixtures');
const D = (v: string) => new Prisma.Decimal(v);
const belajoyce = async () => parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml')));

const item = (over: Partial<PreviewOrderItem>): PreviewOrderItem => ({
  lineId: 'L1', ean: null, marketplaceSku: null, description: null,
  quantity: D('1'), revenue: D('45.00'), soldAt: new Date('2026-11-20'), ...over,
});

describe('buildCostPoolFromInvoice', () => {
  it('bonificação vira 1 entrada por EAN com os 3 candidatos (pending_review, origem rastreável)', async () => {
    const pool = buildCostPoolFromInvoice(await belajoyce());
    const g = pool.find((e) => e.ean === '7897947607996')!;
    expect(g.isBonus).toBe(true);
    expect(g.approvalStatus).toBe('pending_review');
    expect(g.allocationRuleId).toBeNull();
    expect(g.candidates).toHaveLength(3);
    expect(g.sourceDocument).toBe('NF-e 1926966');
    expect(g.sourceHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    // não deve existir entrada de linha duplicada para o mesmo EAN
    expect(pool.filter((e) => e.ean === '7897947607996')).toHaveLength(1);
  });

  it('propaga aviso de outras despesas não alocadas (ex.: PDF com vOutro)', () => {
    const doc: UnifiedInvoice = {
      extractionIncomplete: false,
      source: 'pdf', originalFilename: 'danfe-luciana.pdf', fileHashSha256: 'f'.repeat(64),
      invoiceNumber: '2325345', invoiceSeries: '003', invoiceKey: null,
      issuerCnpj: null, recipientCnpj: null, issuedAt: new Date('2026-10-28'),
      productsTotal: D('6010.44'), otherExpenses: D('2.49'), discounts: null,
      documentTotal: D('6012.93'), fiscalTotal: D('6012.93'), paymentAmountInDocument: null,
      hasBonus: false, bonusAmount: null, paidAmount: null, bonusCalculations: [],
      warnings: [],
      lines: [{
        lineNumber: '1', sourceRef: 'linha 1', supplierProductCode: '5080', ean: null, marketplaceSku: null,
        description: 'PRODUTO LUCIANA', ncm: null, unit: null, quantity: D('316'),
        unitCostExtracted: D('15.9852'), unitCostPaid: D('15.9852'), totalLine: D('5051.33'),
        discount: null, otherExpense: null, cfop: null, lotNumber: null, fabricationDate: null, expiryDate: null, isBonus: false,
        approvedAcquisitionCost: null, warnings: [],
      }],
    };
    const pool = buildCostPoolFromInvoice(doc);
    const e = pool.find((x) => x.supplierCode === '5080')!;
    expect(e.candidates[0].unitCost!.equals(D('15.9852'))).toBe(true);
    expect(e.warnings!.some((w) => /outras despesas/i.test(w))).toBe(true);
    expect(e.approvalStatus).toBe('pending_review');
  });
});

describe('computeOrderCmvPreview', () => {
  it('item da NF 1926966 (EAN bonificado): 3 candidatos, cmv_indicativo null, range min/max', async () => {
    const pool = buildCostPoolFromInvoice(await belajoyce());
    const cmv = computeOrderCmvPreview('order-1', [item({ ean: '7897947607996', description: 'Produto B' })], pool, DEFAULT_STRATEGY);
    const it = cmv.items[0];
    expect(it.cost_status).toBe('estimated');
    expect(it.cost_candidates).toHaveLength(3);
    expect(it.cmv_indicativo).toBeNull();
    expect(it.observacao).toBe('Aguardando decisão de negócio #2');
    expect(it.cost_candidates.map((c) => c.rule_key)).toContain('rateio_proporcional_valor_nominal');
    // range: min ~0.0197 (dilui), max 13.46 (sem custo)
    expect(cmv.totals.cmv_estimado_max!.equals(D('13.46'))).toBe(true);
    expect(cmv.totals.cmv_estimado_min!.lt(D('1'))).toBe(true);
    expect(cmv.totals.cmv_indicativo).toBeNull();
    expect(cmv.totals.lucro_bruto).toBeNull();
    expect(cmv.totals.itens_estimados).toBe(1);
  });

  it('item sem correspondência → indisponível, cmv null, origem ausente', async () => {
    const pool = buildCostPoolFromInvoice(await belajoyce());
    const cmv = computeOrderCmvPreview('order-2', [item({ ean: '0000000000000' })], pool, DEFAULT_STRATEGY);
    expect(cmv.items[0].cost_status).toBe('unavailable');
    expect(cmv.items[0].cmv_indicativo).toBeNull();
    expect(cmv.totals.itens_indisponiveis).toBe(1);
  });

  it('item NÃO bonificado com custo único → cmv_indicativo preenchido (estimado)', async () => {
    const pool = buildCostPoolFromInvoice(await belajoyce());
    // EAN 7897947606517 (item 1, não bonificado): custo direto 16.57
    const cmv = computeOrderCmvPreview('order-3', [item({ ean: '7897947606517', quantity: D('2'), revenue: D('80.00') })], pool, DEFAULT_STRATEGY);
    const it = cmv.items[0];
    expect(it.cost_status).toBe('estimated');
    expect(it.cost_candidates).toHaveLength(1);
    expect(it.cmv_indicativo!.equals(D('33.14'))).toBe(true); // 16.57 * 2
    expect(cmv.totals.cmv_indicativo!.equals(D('33.14'))).toBe(true);
    expect(cmv.totals.margem).not.toBeNull();
  });
});
