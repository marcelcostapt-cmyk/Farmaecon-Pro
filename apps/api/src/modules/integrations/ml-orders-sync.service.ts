import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { MarketplacePlatform, OrderStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_MARKETPLACE_SYNC } from '../../shared/queue/queue.module';
import { MlApiService, MlOrderPage, MlOrderSearchResult } from './ml-api.service';

export const ORDER_SYNC_OPERATION = 'ORDERS';
export const DEFAULT_ORDER_PAGE_SIZE = 50;

export type OrderSyncStatus = 'PARTIAL' | 'COMPLETE' | 'FAILED';

export interface SyncOrdersResult {
  accountId: string;
  importedCount: number;
  expectedTotal: number | null;
  nextOffset: number;
  status: OrderSyncStatus;
}

interface AccountForSync {
  id: string;
  tenantId: string;
  platform: MarketplacePlatform;
  source: string;
  lastSyncedAt: Date | null;
}

@Injectable()
export class MlOrdersSyncService {
  private readonly logger = new Logger(MlOrdersSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mlApi: MlApiService,
    @Optional() @InjectQueue(QUEUE_MARKETPLACE_SYNC) private readonly syncQueue?: Queue,
  ) {}

  /**
   * Processes exactly one page. The checkpoint and page upserts are committed
   * in one transaction, so a retry cannot advance the cursor without its data.
   */
  async syncRecentOrders(accountId: string, tenantId: string): Promise<SyncOrdersResult> {
    if (!accountId || !tenantId) throw new Error('Account and tenant are required');

    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId, status: 'ACTIVE' },
      select: {
        id: true,
        tenantId: true,
        platform: true,
        source: true,
        lastSyncedAt: true,
      },
    }) as AccountForSync;

    if (account.platform !== MarketplacePlatform.MERCADO_LIVRE) {
      throw new Error(`Account ${accountId} is not a Mercado Livre account`);
    }

    let state = await this.prisma.marketplaceSyncState.findUnique({
      where: {
        tenantId_marketplaceAccountId_operation: {
          tenantId,
          marketplaceAccountId: accountId,
          operation: ORDER_SYNC_OPERATION,
        },
      },
    });

    if (!state) {
      state = await this.prisma.marketplaceSyncState.create({
        data: {
          tenantId,
          marketplaceAccountId: accountId,
          operation: ORDER_SYNC_OPERATION,
          status: 'PARTIAL',
          nextOffset: 0,
          pageSize: DEFAULT_ORDER_PAGE_SIZE,
          expectedTotal: null,
          importedCount: 0,
          completedPages: 0,
          lastError: null,
        },
      });
    } else if (state.status === 'COMPLETE' && account.source !== 'SIMULATED') {
      // A new manual sync starts a fresh bounded pass. PARTIAL/FAILED states
      // resume from their persisted cursor instead of starting over.
      await this.prisma.marketplaceSyncState.updateMany({
        where: { id: state.id, tenantId, marketplaceAccountId: accountId },
        data: {
          status: 'PARTIAL',
          nextOffset: 0,
          expectedTotal: null,
          importedCount: 0,
          completedPages: 0,
          lastError: null,
          completedAt: null,
        },
      });
      state = {
        ...state,
        status: 'PARTIAL',
        nextOffset: 0,
        expectedTotal: null,
        importedCount: 0,
        completedPages: 0,
        lastError: null,
        completedAt: null,
      };
    }

    const attemptAt = new Date();

    try {
      if (account.source === 'SIMULATED') {
        const simulatedOrders: MlOrderSearchResult[] = [
          { id: `sim-${account.id}-1`, status: 'paid', total_amount: 125.5, date_created: new Date().toISOString() },
          { id: `sim-${account.id}-2`, status: 'payment_required', total_amount: 80, date_created: new Date().toISOString() },
        ];
        return await this.persistPage(account, state, {
          results: simulatedOrders,
          offset: 0,
          limit: simulatedOrders.length,
          total: simulatedOrders.length,
          nextOffset: simulatedOrders.length,
          complete: true,
        }, attemptAt);
      }

      const page = await this.mlApi.listSellerOrdersPage(accountId, tenantId, {
        limit: state.pageSize,
        offset: state.nextOffset,
      });

      if (state.expectedTotal !== null && state.expectedTotal !== page.total) {
        throw new Error('Order pagination total changed during synchronization');
      }

      const result = await this.persistPage(account, state, page, attemptAt);
      if (result.status === 'PARTIAL') await this.enqueueContinuation(accountId, tenantId, result.nextOffset);
      return result;
    } catch (error) {
      const code = this.classifyError(error);
      await this.prisma.marketplaceSyncState.updateMany({
        where: { id: state.id, tenantId, marketplaceAccountId: accountId },
        data: { status: 'FAILED', lastError: code },
      });
      await this.prisma.marketplaceAccount.updateMany({
        where: { id: accountId, tenantId },
        data: { lastSyncState: 'FAILED', lastSyncAttemptAt: attemptAt, lastSyncError: code },
      });
      throw error;
    }
  }

  private async persistPage(
    account: AccountForSync,
    state: any,
    page: MlOrderPage,
    attemptAt: Date,
  ): Promise<SyncOrdersResult> {
    const status: OrderSyncStatus = page.complete ? 'COMPLETE' : 'PARTIAL';
    const completedAt = page.complete ? attemptAt : null;
    // Count persisted rows after the upserts. This reports actual unique local
    // coverage and does not overstate progress when a worker replays a page.
    let importedCount = 0;

    await this.prisma.$transaction(async (tx: any) => {
      for (const order of page.results) {
        const externalOrderId = String(order.id);
        const totalAmount = this.resolveTotalAmount(order);
        const createdAt = this.resolveOrderDate(order);
        const orderStatus = this.mapOrderStatus(order.status);

        await tx.order.upsert({
          where: {
            tenantId_marketplaceAccountId_externalOrderId: {
              tenantId: account.tenantId,
              marketplaceAccountId: account.id,
              externalOrderId,
            },
          },
          update: { totalAmount, status: orderStatus, createdAt },
          create: {
            tenantId: account.tenantId,
            marketplaceAccountId: account.id,
            externalOrderId,
            totalAmount,
            status: orderStatus,
            createdAt,
          },
        });
      }

      importedCount = await tx.order.count({
        where: { tenantId: account.tenantId, marketplaceAccountId: account.id },
      });

      await tx.marketplaceSyncState.updateMany({
        where: { id: state.id, tenantId: account.tenantId, marketplaceAccountId: account.id },
        data: {
          status,
          nextOffset: page.nextOffset,
          expectedTotal: page.total,
          importedCount,
          completedPages: { increment: 1 },
          lastError: null,
          completedAt,
        },
      });

      await tx.marketplaceAccount.updateMany({
        where: { id: account.id, tenantId: account.tenantId },
        data: {
          lastSyncState: status,
          lastSyncAttemptAt: attemptAt,
          lastSyncError: null,
          ...(page.complete ? { lastSyncedAt: attemptAt } : {}),
        },
      });
    });

    this.logger.log(
      `Imported page offset=${page.offset} count=${page.results.length} total=${page.total} state=${status} for account ${account.id}`,
    );
    return {
      accountId: account.id,
      importedCount,
      expectedTotal: page.total,
      nextOffset: page.nextOffset,
      status,
    };
  }

  private async enqueueContinuation(accountId: string, tenantId: string, nextOffset: number) {
    if (!this.syncQueue) return;
    await this.syncQueue.add(
      'sync-account-orders',
      { tenantId, accountId },
      {
        jobId: `orders:${tenantId}:${accountId}:${nextOffset}`,
        attempts: 5,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    );
  }

  private classifyError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('pagination total changed')) return 'PAGINATION_TOTAL_CHANGED';
    if (message.includes('pagination')) return 'PAGINATION_INCOMPLETE';
    if (message.includes('Mercado Livre API error 401')) return 'AUTH_EXPIRED';
    if (message.includes('Mercado Livre API error 403')) return 'AUTH_FORBIDDEN';
    if (message.includes('Mercado Livre API error 429')) return 'RATE_LIMITED';
    return 'SYNC_ERROR';
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
