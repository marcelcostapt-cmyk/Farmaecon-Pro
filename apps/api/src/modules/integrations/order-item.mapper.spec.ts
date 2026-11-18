import { Prisma } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mapOrderItems, mapOrderFinance } from './order-item.mapper';

const fixture = JSON.parse(
  readFileSync(join(__dirname, '../../../test/fixtures/ml-order.json'), 'utf8'),
).sample_order_sanitized;
const ctx = { tenantId: 't', marketplaceAccountId: 'acc', orderId: 'ord' };

describe('order-item.mapper', () => {
  it('maps a line with element_id, sku, quantity, price and sale_fee', () => {
    const items = mapOrderItems(fixture, ctx);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      tenantId: 't', marketplaceAccountId: 'acc', orderId: 'ord',
      mlElementId: '1', sellerSkuRaw: '6 MARCADORES NEON', quantity: 1,
    });
    expect(items[0].unitPrice.equals(new Prisma.Decimal('15.53'))).toBe(true);
    expect(items[0].saleFee!.equals(new Prisma.Decimal('1.79'))).toBe(true);
  });

  it('distinguishes two items by element_id and keeps absent fields null, never 0', () => {
    const order = {
      order_items: [
        { element_id: 1, item: { id: 'MLB1', seller_sku: 'A' }, quantity: 2, unit_price: 10 },
        { element_id: 2, item: { id: 'MLB2', seller_sku: 'B' }, quantity: 1, unit_price: 5 },
      ],
    };
    const items = mapOrderItems(order, ctx);
    expect(items.map((i) => i.mlElementId)).toEqual(['1', '2']);
    expect(items[0].saleFee).toBeNull();
    expect(items[0].grossPrice).toBeNull();
  });

  it('mapOrderFinance reads paid amount, dates, pack id and the payments snapshot', () => {
    const fin = mapOrderFinance(fixture);
    expect(fin.mlDateCreated).toBeInstanceOf(Date);
    expect(fin.packId).toBe(String(fixture.pack_id));
    expect(fin.paidAmount!.equals(new Prisma.Decimal('15.53'))).toBe(true);
    expect(fin.mlPaymentsRaw).toBeDefined();
  });
});
