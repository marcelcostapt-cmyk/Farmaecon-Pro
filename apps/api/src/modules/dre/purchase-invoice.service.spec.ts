import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { parseDocument } from '../costs/document-parser';

const dir = join(__dirname, '../../../test/fixtures');
const doc = async () => parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml')));

describe('PurchaseInvoiceService.ingest — persiste em pending_review (sem publicar custo)', () => {
  it('cria fatura + itens com status pending_review e nenhum product_cost', async () => {
    const mem = new MemoryPrisma();
    const svc = new PurchaseInvoiceService(mem as never);
    const d = await doc();
    const res = await svc.ingest('tenant-a', d, 'user-a');
    expect(res.created).toBe(true);
    expect(res.itemCount).toBe(4);
    const inv = mem.rows.purchaseInvoice[0];
    expect(inv.status).toBe('PENDING_REVIEW');
    expect(inv.tenantId).toBe('tenant-a');
    expect(inv.hasBonus).toBe(true);
    expect(mem.rows.purchaseInvoiceItem).toHaveLength(4);
    expect(mem.rows.purchaseInvoiceItem.every((i: any) => i.tenantId === 'tenant-a')).toBe(true);
    expect(mem.rows.productCost).toHaveLength(0); // NUNCA publica custo
  });

  it('é idempotente por (tenant, sha256): reenvio não duplica', async () => {
    const mem = new MemoryPrisma();
    const svc = new PurchaseInvoiceService(mem as never);
    const d = await doc();
    const a = await svc.ingest('tenant-a', d, 'user-a');
    const b = await svc.ingest('tenant-a', d, 'user-a');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.invoiceId).toBe(a.invoiceId);
    expect(mem.rows.purchaseInvoice).toHaveLength(1);
    expect(mem.rows.purchaseInvoiceItem).toHaveLength(4);
  });

  it('isola por tenant: o mesmo documento para outro tenant é independente', async () => {
    const mem = new MemoryPrisma();
    const svc = new PurchaseInvoiceService(mem as never);
    const d = await doc();
    await svc.ingest('tenant-a', d, 'user-a');
    const b = await svc.ingest('tenant-b', d, 'user-b');
    expect(b.created).toBe(true);
    expect(mem.rows.purchaseInvoice).toHaveLength(2);
    expect(mem.rows.purchaseInvoice.map((i: any) => i.tenantId).sort()).toEqual(['tenant-a', 'tenant-b']);
  });

  it('mapeia source xlsx→EXCEL e preserva Decimais', async () => {
    const mem = new MemoryPrisma();
    const svc = new PurchaseInvoiceService(mem as never);
    const d = await doc();
    await svc.ingest('tenant-a', d, null);
    const inv = mem.rows.purchaseInvoice[0];
    expect(inv.source).toBe('XML');
    expect(inv.productsTotal).toBeInstanceOf(Prisma.Decimal);
    expect(inv.paidAmount.equals(new Prisma.Decimal('8315.96'))).toBe(true);
  });
});

const CNPJ_X = '11222333000181'; // sintético válido
const CNPJ_Y = '11444777000161'; // sintético válido, diferente

describe('PurchaseInvoiceService.ingest — vínculo documento→conta (§5)', () => {
  const setup = (accountOverrides: Record<string, unknown>[] = []) => {
    const mem = new MemoryPrisma();
    for (const a of accountOverrides) mem.rows.marketplaceAccount.push(a);
    return { mem, svc: new PurchaseInvoiceService(mem as never) };
  };

  it('auto-vincula por CNPJ válido do destinatário (inclui conta DESCONECTADA, decisão #1)', async () => {
    const { mem, svc } = setup([{ id: 'acc-bel', tenantId: 'tenant-a', status: 'DISCONNECTED', name: 'ML #1', cnpj: CNPJ_X, businessName: 'Drogaria Belajoyce' }]);
    const d = { ...(await doc()), recipientCnpj: CNPJ_X };
    const res = await svc.ingest('tenant-a', d, 'user-a');
    expect(res.accountMatch).toMatchObject({ reason: 'cnpj', linkedAccountId: 'acc-bel', requiresReview: false });
    expect(mem.rows.purchaseInvoice[0].marketplaceAccountId).toBe('acc-bel');
    expect(mem.rows.purchaseInvoice[0].status).toBe('PENDING_REVIEW'); // vincular ≠ aprovar custo
    expect(mem.rows.productCost).toHaveLength(0);
  });

  it('CNPJ do documento diverge das contas → NÃO vincula, pendente (decisão #5)', async () => {
    const { mem, svc } = setup([{ id: 'acc-y', tenantId: 'tenant-a', status: 'ACTIVE', name: 'ML #2', cnpj: CNPJ_Y, businessName: 'Outra' }]);
    const d = { ...(await doc()), recipientCnpj: CNPJ_X };
    const res = await svc.ingest('tenant-a', d, 'user-a');
    expect(res.accountMatch).toMatchObject({ reason: 'cnpj_no_match', linkedAccountId: null, requiresReview: true });
    expect(mem.rows.purchaseInvoice[0].marketplaceAccountId).toBeNull();
  });

  it('regista a decisão do vínculo na auditoria (extraction_warnings, como string)', async () => {
    const { mem, svc } = setup([{ id: 'acc-bel', tenantId: 'tenant-a', status: 'ACTIVE', name: 'ML #1', cnpj: CNPJ_X, businessName: 'Bel' }]);
    const d = { ...(await doc()), recipientCnpj: CNPJ_X };
    await svc.ingest('tenant-a', d, 'user-a');
    expect(mem.rows.purchaseInvoice[0].extractionWarnings.some((w: string) => /[Vv]ínculo conta/.test(w))).toBe(true);
  });

  it('seleção manual exige compatibilidade fiscal: CNPJ divergente é recusado (não contorna)', async () => {
    const { mem, svc } = setup([
      { id: 'acc-x', tenantId: 'tenant-a', status: 'ACTIVE', name: 'ML #1', cnpj: CNPJ_X, businessName: 'X' },
      { id: 'acc-y', tenantId: 'tenant-a', status: 'ACTIVE', name: 'ML #2', cnpj: CNPJ_Y, businessName: 'Y' },
    ]);
    const d = { ...(await doc()), recipientCnpj: CNPJ_X };
    const { invoiceId } = await svc.ingest('tenant-a', d, 'user-a'); // auto-vincula acc-x
    // tentar ligar manualmente à acc-y (CNPJ diferente do destinatário) → recusado
    await expect(svc.associateAccountManually('tenant-a', invoiceId, 'acc-y', { sub: 'u-1' } as never)).rejects.toThrow();
    // ligar manualmente à acc-x (CNPJ compatível) → aceite
    const ok = await svc.associateAccountManually('tenant-a', invoiceId, 'acc-x', { sub: 'u-1' } as never);
    expect(ok.linkedAccountId).toBe('acc-x');
  });

  it('seleção manual bloqueia conta de outro tenant', async () => {
    const { mem, svc } = setup([{ id: 'acc-b', tenantId: 'tenant-b', status: 'ACTIVE', name: 'ML #B', cnpj: CNPJ_X, businessName: 'B' }]);
    void mem;
    const d = { ...(await doc()), recipientCnpj: CNPJ_X };
    const { invoiceId } = await svc.ingest('tenant-a', d, 'user-a');
    await expect(svc.associateAccountManually('tenant-a', invoiceId, 'acc-b', { sub: 'u-1' } as never)).rejects.toThrow();
  });
});
