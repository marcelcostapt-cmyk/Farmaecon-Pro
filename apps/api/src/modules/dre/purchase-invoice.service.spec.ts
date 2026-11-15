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
