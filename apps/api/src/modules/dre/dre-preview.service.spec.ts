import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { DrePreviewService } from './dre-preview.service';
import { parseDocument } from '../costs/document-parser';

const dir = join(__dirname, '../../../test/fixtures');
const D = (v: string) => new Prisma.Decimal(v);

async function setup() {
  const mem = new MemoryPrisma();
  const ingest = new PurchaseInvoiceService(mem as never);
  const svc = new DrePreviewService(mem as never);
  const doc = await parseDocument('NFe_1926966.xml', readFileSync(join(dir, 'nfe-belajoyce.xml')));
  await ingest.ingest('tenant-a', doc, 'user-a'); // pool pending_review
  const order = await mem.order.create({ data: { tenantId: 'tenant-a', marketplaceAccountId: 'acc-1', externalOrderId: 'E1', totalAmount: 110, status: 'PAID', mlDateCreated: new Date('2026-11-20') } });
  await mem.orderItem.create({ data: { tenantId: 'tenant-a', marketplaceAccountId: 'acc-1', orderId: order.id, mlElementId: 'el1', title: 'PRODUTO A', sellerSkuRaw: null, quantity: 2, unitPrice: D('40.00') } });
  await mem.orderItem.create({ data: { tenantId: 'tenant-a', marketplaceAccountId: 'acc-1', orderId: order.id, mlElementId: 'el2', title: 'DESCONHECIDO', sellerSkuRaw: null, quantity: 1, unitPrice: D('30.00') } });
  return { mem, svc, orderId: order.id };
}

describe('DrePreviewService — preview ligado à BD (MemoryPrisma)', () => {
  it('orderCmvPreview: item casado por descrição recebe indicativo; sem match fica indisponível', async () => {
    const { svc, orderId } = await setup();
    const cmv = await svc.orderCmvPreview('tenant-a', orderId);
    expect(cmv.status).toBe('preview');
    const casado = cmv.items.find((i) => i.description === 'PRODUTO A')!;
    expect(casado.cost_status).toBe('estimated');
    expect(casado.cmv_indicativo!.equals(D('33.14'))).toBe(true); // 16.57 * 2
    const sem = cmv.items.find((i) => i.description === 'DESCONHECIDO')!;
    expect(sem.cost_status).toBe('unavailable');
    expect(cmv.totals.itens_indisponiveis).toBe(1);
    expect(cmv.totals.revenue.equals(D('110.00'))).toBe(true);
  });

  it('pedido inexistente → NotFound', async () => {
    const { svc } = await setup();
    await expect(svc.orderCmvPreview('tenant-a', 'nao-existe')).rejects.toThrow(/não encontrado/i);
  });

  it('drePreview agrega o período e nunca publica custo (product_costs vazio)', async () => {
    const { svc, mem } = await setup();
    const dre = await svc.drePreview('tenant-a', { groupBy: 'product' });
    expect(dre.status).toBe('preview');
    expect(dre.summary.receita_total.equals(D('110.00'))).toBe(true);
    // há item indisponível → total indicativo null, mas a linha do produto casado tem indicativo
    expect(dre.summary.cmv_total_indicativo).toBeNull();
    const casado = dre.lines.find((l) => l.product_description === 'PRODUTO A')!;
    expect(casado.cmv_indicativo!.equals(D('33.14'))).toBe(true);
    expect(mem.rows.productCost).toHaveLength(0);
  });

  it('isolamento: outro tenant não vê o pedido nem o custo', async () => {
    const { svc } = await setup();
    await expect(svc.orderCmvPreview('tenant-b', 'order-0')).rejects.toThrow(/não encontrado/i);
  });
});
