import { Prisma } from '@prisma/client';
import { money } from '../costs/cost-money';

// The ML /orders/search result carries more than RemoteOrder types; read defensively.
interface MlItem { id?: unknown; title?: unknown; category_id?: unknown; variation_id?: unknown; variation_attributes?: unknown; seller_sku?: unknown; }
interface MlOrderItem { element_id?: unknown; item?: MlItem; quantity?: unknown; unit_price?: unknown; gross_price?: unknown; sale_fee?: unknown; listing_type_id?: unknown; currency_id?: unknown; }
interface MlOrderForItems {
  order_items?: MlOrderItem[]; paid_amount?: unknown; date_created?: unknown; date_closed?: unknown;
  pack_id?: unknown; status_detail?: unknown; payments?: unknown;
}

export interface ItemCtx { tenantId: string; marketplaceAccountId: string; orderId: string; }

export interface OrderItemInput {
  tenantId: string; marketplaceAccountId: string; orderId: string;
  mlItemId: string | null; mlElementId: string; sellerSkuRaw: string | null;
  title: string | null; categoryId: string | null; variationId: string | null;
  variationAttributes: Prisma.InputJsonValue | undefined;
  quantity: number; unitPrice: Prisma.Decimal; grossPrice: Prisma.Decimal | null; saleFee: Prisma.Decimal | null;
  listingTypeId: string | null; currencyId: string | null;
}

export interface OrderFinanceInput {
  paidAmount: Prisma.Decimal | null; mlDateCreated: Date | null; mlDateClosed: Date | null;
  packId: string | null; statusDetail: string | null; mlPaymentsRaw: Prisma.InputJsonValue | undefined;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : v == null ? null : String(v));
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const dec = (v: unknown): Prisma.Decimal | null => { const n = num(v); return n === null ? null : money(n); };
const toDate = (v: unknown): Date | null => { if (typeof v !== 'string') return null; const d = new Date(v); return Number.isFinite(d.getTime()) ? d : null; };

/** One OrderItemInput per sold line. Missing numbers stay null (never fabricated 0);
 *  a line without a usable quantity or unit price is skipped rather than stored with a fake value. */
export function mapOrderItems(order: MlOrderForItems, ctx: ItemCtx): OrderItemInput[] {
  const items = Array.isArray(order.order_items) ? order.order_items : [];
  const out: OrderItemInput[] = [];
  items.forEach((it, index) => {
    const quantity = num(it.quantity);
    const unitPrice = dec(it.unit_price);
    if (quantity === null || !Number.isInteger(quantity) || unitPrice === null) return; // skip malformed line
    const item = it.item ?? {};
    out.push({
      tenantId: ctx.tenantId, marketplaceAccountId: ctx.marketplaceAccountId, orderId: ctx.orderId,
      mlItemId: str(item.id), mlElementId: String(it.element_id ?? index),
      sellerSkuRaw: str(item.seller_sku), title: str(item.title), categoryId: str(item.category_id),
      variationId: str(item.variation_id),
      variationAttributes: (item.variation_attributes ?? undefined) as Prisma.InputJsonValue | undefined,
      quantity, unitPrice, grossPrice: dec(it.gross_price), saleFee: dec(it.sale_fee),
      listingTypeId: str(it.listing_type_id), currencyId: str(it.currency_id),
    });
  });
  return out;
}

export function mapOrderFinance(order: MlOrderForItems): OrderFinanceInput {
  return {
    paidAmount: dec(order.paid_amount), mlDateCreated: toDate(order.date_created), mlDateClosed: toDate(order.date_closed),
    packId: str(order.pack_id), statusDetail: str(order.status_detail),
    mlPaymentsRaw: (order.payments ?? undefined) as Prisma.InputJsonValue | undefined,
  };
}
