import { Injectable, Logger } from '@nestjs/common';
import { MarketplacePlatform, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MlApiService } from './ml-api.service';

interface SyncOrdersResult {
  accountId: string;
  importedCount: number;
}

@Injectable()
export class MlOrdersSyncService {
  private readonly logger = new Logger(MlOrdersSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mlApi: MlApiService,
  ) {}

  async syncRecentOrders(accountId: string, tenantId: string): Promise<SyncOrdersResult> {
    if (!accountId || !tenantId) throw new Error('Account and tenant are required');
    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        tenantId: true,
        platform: true, source: true,
      },
    });

    if (account.platform !== MarketplacePlatform.MERCADO_LIVRE) {
      throw new Error(`Account ${accountId} is not a Mercado Livre account`);
    }

    const remoteOrders = account.source === 'SIMULATED'
      ? [{ id: `sim-${account.id}-1`, status: 'paid', total_amount: 125.50, date_created: new Date().toISOString() },
         { id: `sim-${account.id}-2`, status: 'payment_required', total_amount: 80, date_created: new Date().toISOString() }]
      : await this.mlApi.listSellerOrders(accountId, tenantId);

    if (remoteOrders.length === 0) {
      this.logger.log(`No Mercado Livre orders found for account ${accountId}`);
      await this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId }, data: { lastSyncedAt: new Date() } });
      return { accountId, importedCount: 0 };
    }

    const operations: Prisma.PrismaPromise<unknown>[] = remoteOrders.map((order) => {
      const externalOrderId = String(order.id);
      const totalAmount = this.resolveTotalAmount(order);
      const createdAt = this.resolveOrderDate(order);
      const status = this.mapOrderStatus(order.status);

      return this.prisma.order.upsert({
        where: {
          tenantId_externalOrderId: {
            tenantId: account.tenantId,
            externalOrderId,
          },
        },
        update: {
          marketplaceAccountId: account.id,
          totalAmount,
          status,
        },
        create: {
          tenantId: account.tenantId,
          marketplaceAccountId: account.id,
          externalOrderId,
          totalAmount,
          status,
          createdAt,
        },
      });
    });

    await this.prisma.$transaction([...operations, this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId }, data: { lastSyncedAt: new Date() } })]);

    this.logger.log(`Imported ${remoteOrders.length} Mercado Livre orders for account ${accountId}`);
    return { accountId, importedCount: remoteOrders.length };
  }

  private resolveTotalAmount(order: { total_amount?: number; total_amount_with_shipping?: number }) {
    return Number(order.total_amount_with_shipping ?? order.total_amount ?? 0);
  }

  private resolveOrderDate(order: { date_created?: string; date_closed?: string }) {
    const rawDate = order.date_created ?? order.date_closed;
    const parsed = rawDate ? new Date(rawDate) : new Date();
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  private mapOrderStatus(status?: string): OrderStatus {
    switch (status) {
      case 'paid':
      case 'partially_refunded':
        return OrderStatus.PAID;
      case 'cancelled':
      case 'cancelled_by_user':
        return OrderStatus.CANCELED;
      case 'confirmed':
      case 'payment_required':
      case 'payment_in_process':
      case 'partially_paid':
      case 'pending_cancel':
      default:
        return OrderStatus.PENDING;
    }
  }
}
