import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DEFAULT_STRATEGY, type CostPoolEntry } from '../costs/cost-matching';
import {
  buildCostPoolFromDb,
  type DbPurchaseInvoice,
  type DbPurchaseInvoiceItem,
} from '../costs/cost-pool-db';
import { computeOrderCmvPreview, type CmvPreview, type PreviewOrderItem } from '../costs/cmv-preview';
import { computeDrePreview, type DrePreview, type DreOrderRow, type GroupBy } from '../costs/dre-preview';
import { expiringLots, type ExpiringLot, type LotRow } from '../costs/lot-expiry';

export interface DreFilters {
  accountId?: string;
  start?: Date;
  end?: Date;
  groupBy: GroupBy;
}

@Injectable()
export class DrePreviewService {
  constructor(private readonly prisma: PrismaService) {}

  /** Acervo de custos do tenant (apenas documentos não publicados: extracted/pending_review). */
  private async costPool(tenantId: string): Promise<CostPoolEntry[]> {
    const invoices = await this.prisma.purchaseInvoice.findMany({
      where: { tenantId, status: { in: ['EXTRACTED', 'PENDING_REVIEW'] } },
    });
    const bundles: Array<{ invoice: DbPurchaseInvoice; items: DbPurchaseInvoiceItem[] }> = [];
    for (const inv of invoices) {
      const items = await this.prisma.purchaseInvoiceItem.findMany({
        where: { tenantId, purchaseInvoiceId: inv.id },
      });
      bundles.push({ invoice: inv as unknown as DbPurchaseInvoice, items: items as unknown as DbPurchaseInvoiceItem[] });
    }
    return buildCostPoolFromDb(bundles);
  }

  private revenue(item: { unitPrice: Prisma.Decimal; quantity: number }): Prisma.Decimal {
    return new Prisma.Decimal(item.unitPrice).times(item.quantity);
  }

  async orderCmvPreview(tenantId: string, orderId: string): Promise<CmvPreview> {
    const order = await this.prisma.order.findFirst({ where: { tenantId, id: orderId } });
    if (!order) throw new NotFoundException('Pedido não encontrado');
    const items = await this.prisma.orderItem.findMany({ where: { tenantId, orderId } });
    const pool = await this.costPool(tenantId);
    const soldAt: Date = order.mlDateCreated ?? order.createdAt;
    const previewItems: PreviewOrderItem[] = items.map((i) => ({
      lineId: i.id,
      ean: null, // order_items do ML não guardam EAN; matching por SKU/descrição
      marketplaceSku: i.sellerSkuRaw ?? null,
      description: i.title ?? null,
      quantity: new Prisma.Decimal(i.quantity),
      revenue: this.revenue(i),
      soldAt,
    }));
    return computeOrderCmvPreview(orderId, previewItems, pool, DEFAULT_STRATEGY);
  }

  async drePreview(tenantId: string, filters: DreFilters): Promise<DrePreview> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.accountId) where.marketplaceAccountId = filters.accountId;
    if (filters.start || filters.end)
      where.createdAt = { ...(filters.start ? { gte: filters.start } : {}), ...(filters.end ? { lte: filters.end } : {}) };

    const orders = await this.prisma.order.findMany({ where });
    const pool = await this.costPool(tenantId);
    const rows: DreOrderRow[] = [];
    for (const o of orders) {
      const items = await this.prisma.orderItem.findMany({ where: { tenantId, orderId: o.id } });
      const soldAt: Date = o.mlDateCreated ?? o.createdAt;
      for (const i of items) {
        rows.push({
          accountId: o.marketplaceAccountId,
          date: soldAt,
          ean: null,
          marketplaceSku: i.sellerSkuRaw ?? null,
          description: i.title ?? null,
          quantity: new Prisma.Decimal(i.quantity),
          revenue: this.revenue(i),
        });
      }
    }
    return computeDrePreview(rows, pool, DEFAULT_STRATEGY, filters.groupBy);
  }

  /** Lotes vencidos ou a vencer em até `windowDays` dias (só leitura; inclui o estado da fatura de origem). */
  async expiringLots(tenantId: string, now: Date, windowDays: number): Promise<ExpiringLot[]> {
    // Inclusivo até ao fim do dia `now + windowDays` (cutoff exclusivo no início do dia seguinte).
    const cutoff = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + windowDays + 1));
    const items = await this.prisma.purchaseInvoiceItem.findMany({
      where: { tenantId, expiryDate: { not: null, lt: cutoff } },
      select: {
        id: true,
        purchaseInvoiceId: true,
        ean: true,
        description: true,
        lotNumber: true,
        quantity: true,
        expiryDate: true,
        purchaseInvoice: { select: { originalFilename: true, status: true } },
      },
    });
    const rows: LotRow[] = [];
    for (const i of items) {
      if (i.expiryDate === null) continue;
      rows.push({
        itemId: i.id,
        invoiceId: i.purchaseInvoiceId,
        invoiceFilename: i.purchaseInvoice.originalFilename,
        invoiceStatus: i.purchaseInvoice.status,
        ean: i.ean,
        description: i.description,
        lotNumber: i.lotNumber,
        quantity: i.quantity,
        expiryDate: i.expiryDate,
      });
    }
    return expiringLots(rows, now, windowDays);
  }
}
