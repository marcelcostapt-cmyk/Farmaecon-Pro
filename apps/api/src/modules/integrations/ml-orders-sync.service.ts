import { Injectable, Logger } from '@nestjs/common';
import { MarketplacePlatform, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MlApiService } from './ml-api.service';
import { validateOrder } from './order-validation';

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

  async syncRecentOrders(
    accountId: string,
    tenantId: string,
  ): Promise<SyncOrdersResult> {
    if (!accountId || !tenantId)
      throw new Error('Account and tenant are required');
    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        tenantId: true,
        platform: true,
        source: true,
      },
    });

    if (account.platform !== MarketplacePlatform.MERCADO_LIVRE) {
      throw new Error(`Account ${accountId} is not a Mercado Livre account`);
    }

    try {
      const remoteOrders =
        account.source === 'SIMULATED'
          ? [
              {
                id: `sim-${account.id}-1`,
                status: 'paid',
                total_amount: 125.5,
                date_created: new Date().toISOString(),
              },
              {
                id: `sim-${account.id}-2`,
                status: 'payment_required',
                total_amount: 80,
                date_created: new Date().toISOString(),
              },
            ]
          : await this.mlApi.listSellerOrders(accountId, tenantId);

      if (remoteOrders.length === 0) {
        this.logger.log(
          `No Mercado Livre orders found for account ${accountId}`,
        );
        await this.prisma.marketplaceAccount.updateMany({
          where: { id: accountId, tenantId },
          data: {
            lastSyncedAt: new Date(),
            lastSyncState: 'COMPLETE',
            lastSyncAttemptAt: new Date(),
            lastSyncError: null,
          },
        });
        return { accountId, importedCount: 0 };
      }

      const validated = remoteOrders.map((order) => ({
        order,
        ...validateOrder(order, account.source === 'SIMULATED'),
      }));
      await this.prisma.$transaction(async (tx) => {
        for (const {
          order,
          externalOrderId,
          totalAmount,
          createdAt,
        } of validated) {
          const status = this.mapOrderStatus(order.status);

          await tx.order.upsert({
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
              createdAt,
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
        }
        await tx.marketplaceAccount.updateMany({
          where: { id: accountId, tenantId },
          data: {
            lastSyncedAt: new Date(),
            lastSyncState: 'COMPLETE',
            lastSyncAttemptAt: new Date(),
            lastSyncError: null,
          },
        });
      });

      this.logger.log(
        `Imported ${remoteOrders.length} Mercado Livre orders for account ${accountId}`,
      );
      return { accountId, importedCount: remoteOrders.length };
    } catch (error) {
      await this.prisma.marketplaceAccount.updateMany({
        where: { id: accountId, tenantId },
        data: {
          lastSyncState: 'FAILED',
          lastSyncAttemptAt: new Date(),
          lastSyncError: 'ORDER_SYNC_INCOMPLETE',
        },
      });
      throw error;
    }
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
