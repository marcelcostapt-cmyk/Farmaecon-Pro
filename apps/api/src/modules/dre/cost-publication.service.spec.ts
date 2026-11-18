import { MemoryPrisma } from '../../../test/memory-prisma';
import { money } from '../costs/cost-money';
import { CostPublicationService } from './cost-publication.service';
import type { BonusDecision } from '../costs/bonus-allocation';

const TENANT = 'tenant-a';
const ACC = 'acc-1';

function seedInvoice(mem: MemoryPrisma, over: Record<string, unknown> = {}) {
  const inv = {
    id: 'inv-1', tenantId: TENANT, marketplaceAccountId: ACC, status: 'PENDING_REVIEW',
    documentTotal: money('400'), issuedAt: new Date('2026-04-10T00:00:00Z'), createdAt: new Date('2026-05-01T00:00:00Z'),
    hasBonus: false, bonusAmount: null, ...over,
  };
  mem.rows.purchaseInvoice.push(inv);
  mem.rows.marketplaceAccount.push({ id: ACC, tenantId: TENANT, cnpj: '00000000000272' });
  return inv;
}
function seedItem(mem: MemoryPrisma, over: Record<string, unknown>) {
  const item = {
    id: `item-${mem.rows.purchaseInvoiceItem.length}`, tenantId: TENANT, purchaseInvoiceId: 'inv-1',
    lineNumber: '1', ean: null, marketplaceSku: null, supplierProductCode: null, description: 'PROD',
    quantity: money('10'), totalLine: money('100'), isBonus: false, bonusQuantity: money('0'),
    unitCostApproved: null, allocatedBonus: null, allocationRuleId: null, ...over,
  };
  mem.rows.purchaseInvoiceItem.push(item);
  return item;
}
const svc = (mem: MemoryPrisma) => new CostPublicationService(mem as never);
const prop = (bonus: string): BonusDecision => ({ hasBonus: true, bonusAmount: money(bonus), rule: 'PROPORTIONAL' });

describe('CostPublicationService.applyBonus', () => {
  it('grava allocatedBonus/bonusQuantity/unitCostApproved e mantém PENDING_REVIEW', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, { lineNumber: '1', totalLine: money('100'), quantity: money('10') });
    seedItem(mem, { lineNumber: '2', totalLine: money('300'), quantity: money('10') });
    await svc(mem).applyBonus(TENANT, 'inv-1', prop('40'), { sub: 'u1' });
    const i1 = mem.rows.purchaseInvoiceItem.find((i) => i.lineNumber === '1');
    expect(i1.allocatedBonus.toString()).toBe('10');
    expect(i1.unitCostApproved.toString()).toBe('11');
    expect(mem.rows.purchaseInvoice[0].status).toBe('PENDING_REVIEW');
    expect(mem.rows.purchaseInvoice[0].hasBonus).toBe(true);
  });

  it('é substituível: segunda regra sobrepõe a primeira, sem acumular rascunhos', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, { lineNumber: '1', ean: '111', totalLine: money('100'), quantity: money('10') });
    seedItem(mem, { lineNumber: '2', ean: '222', totalLine: money('300'), quantity: money('10') });
    await svc(mem).applyBonus(TENANT, 'inv-1', prop('40'), { sub: 'u1' });
    await svc(mem).applyBonus(TENANT, 'inv-1', { hasBonus: true, bonusAmount: money('0'), rule: 'IGNORE' }, { sub: 'u1' });
    const drafts = mem.rows.costAllocationRule.filter((r) => r.approvedAt === null);
    expect(drafts).toHaveLength(1);
    expect(drafts[0].ruleType).toBe('ZERO_BONUS');
    expect(mem.rows.purchaseInvoiceItem.find((i) => i.lineNumber === '1').allocatedBonus.toString()).toBe('0');
  });

  it('isola por tenant: invoice de outro tenant não é encontrado', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, {});
    await expect(svc(mem).applyBonus('tenant-b', 'inv-1', prop('40'), null)).rejects.toThrow();
  });
});

describe('CostPublicationService.publishCosts', () => {
  async function applied(mem: MemoryPrisma, decision: BonusDecision = prop('40')) {
    await svc(mem).applyBonus(TENANT, 'inv-1', decision, { sub: 'u1' });
  }

  it('cria 1 regra aprovada e 1 product_cost APPROVED por item com custo>0, ligados', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, { lineNumber: '1', ean: '111', totalLine: money('100'), quantity: money('10') });
    seedItem(mem, { lineNumber: '2', ean: '222', totalLine: money('300'), quantity: money('10') });
    await applied(mem);
    const res = await svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' });
    expect(res.publishedCount).toBe(2);
    expect(res.ruleType).toBe('PROPORTIONAL_SPREAD');
    expect(mem.rows.productCost).toHaveLength(2);
    const pc = mem.rows.productCost[0];
    expect(pc.status).toBe('APPROVED');
    expect(pc.marketplaceAccountId).toBe(ACC);
    expect(pc.costAllocationRuleId).toBeTruthy();
    expect(pc.sourceInvoiceItemId).toBeTruthy();
    const rule = mem.rows.costAllocationRule.find((r) => r.id === pc.costAllocationRuleId);
    expect(rule.approvedAt).toBeInstanceOf(Date);
    expect(mem.rows.purchaseInvoice[0].status).toBe('APPROVED');
  });

  it('grava product_cost mesmo sem EAN/SKU, por supplierCode/description', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, { lineNumber: '1', ean: null, marketplaceSku: null, supplierProductCode: '5080', description: 'DIPIRONA' });
    await applied(mem);
    await svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' });
    const pc = mem.rows.productCost[0];
    expect(pc.supplierCode).toBe('5080');
    expect(pc.description).toBe('DIPIRONA');
  });

  it('usa resolveValidFrom (issuedAt) para validFrom', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, {});
    await applied(mem);
    await svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' });
    expect(mem.rows.productCost[0].validFrom).toEqual(new Date('2026-04-10T00:00:00Z'));
  });

  it('bloqueia custo <= 0', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, {});
    await svc(mem).applyBonus(TENANT, 'inv-1', { hasBonus: true, bonusAmount: money('40'), rule: 'PROPORTIONAL', manual: { '1': money('0') } }, { sub: 'u1' });
    await expect(svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' })).rejects.toThrow();
    expect(mem.rows.productCost).toHaveLength(0);
  });

  it('bloqueia documento sem conta vinculada', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem, { marketplaceAccountId: null });
    seedItem(mem, {});
    await applied(mem);
    await expect(svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' })).rejects.toThrow();
  });

  it('bloqueia segundo publish (idempotência: status != PENDING_REVIEW)', async () => {
    const mem = new MemoryPrisma();
    seedInvoice(mem);
    seedItem(mem, {});
    await applied(mem);
    await svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' });
    await expect(svc(mem).publishCosts(TENANT, 'inv-1', { sub: 'u1' })).rejects.toThrow();
    expect(mem.rows.productCost).toHaveLength(1);
  });
});
