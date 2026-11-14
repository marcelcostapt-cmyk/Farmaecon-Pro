import { publicAccountSelect } from '../../shared/security/public-selects';
import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_MARKETPLACE_SYNC, QUEUE_TOKEN_REFRESH } from '../../shared/queue/queue.module';
import { findPendingAccountJobs } from './account-jobs';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { MarketplaceSyncScheduler } from './marketplace-sync.scheduler';
import { MlOAuthService } from './ml-oauth.service';
import { accountConflict } from './account-errors';
import type { AuthPrincipal } from '../auth/auth.service';

export const DISPLAY_NAME_MAX = 60;

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_MARKETPLACE_SYNC) private readonly syncQueue: Queue,
    @InjectQueue(QUEUE_TOKEN_REFRESH) private readonly tokenQueue: Queue,
    private readonly ordersSync: MlOrdersSyncService,
    private readonly oauth: MlOAuthService,
    @Optional() private readonly scheduler?: MarketplaceSyncScheduler,
  ) {}

  async findAll(tenantId: string) {
    const accounts = await this.prisma.marketplaceAccount.findMany({
      where: { tenantId },
      select: {
        ...publicAccountSelect,
        source: true, lastSyncedAt: true, lastSyncState: true,
        lastSyncAttemptAt: true, lastSyncError: true,
        syncStates: { where: { operation: 'ORDERS' }, select: {
          status: true, expectedTotal: true, importedCount: true, nextOffset: true,
          lastError: true,
        }, take: 1 },
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    const nextRuns = await Promise.all(accounts.map((acc) => this.nextSyncAt(acc.id)));
    return accounts.map((acc, index) => ({
      ...acc,
      nextSyncAt: nextRuns[index],
      orderCount: acc._count.orders,
      status: acc.status,
      syncStatus: acc.syncStates[0]?.status ?? acc.lastSyncState ?? 'NOT_STARTED',
      expectedTotal: acc.syncStates[0]?.expectedTotal ?? null,
      importedCount: acc.syncStates[0]?.importedCount ?? 0,
      nextOffset: acc.syncStates[0]?.nextOffset ?? 0,
      lastSyncAttemptAt: acc.lastSyncAttemptAt,
      syncError: acc.syncStates[0]?.lastError ?? acc.lastSyncError ?? null,
    }));
  }

  private async nextSyncAt(accountId: string): Promise<string | null> {
    try {
      return (await this.scheduler?.nextRunAt(accountId))?.toISOString() ?? null;
    } catch {
      return null;
    }
  }

  /** Blank or null clears the friendly name, so the UI falls back to the technical `name`. */
  async rename(tenantId: string, accountId: string, displayName: string | null) {
    const value = displayName?.trim() || null;
    if (value && [...value].length > DISPLAY_NAME_MAX) {
      throw new BadRequestException(`O nome pode ter no máximo ${DISPLAY_NAME_MAX} caracteres.`);
    }
    const updated = await this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId }, data: { displayName: value } });
    if (updated.count === 0) throw new NotFoundException('Account not found');
    return this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: publicAccountSelect });
  }

  async disconnect(tenantId: string, accountId: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { id: true } });
    if (!account) throw new NotFoundException('Account not found');
    await this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId }, data: { status: 'DISCONNECTED', accessToken: null, refreshToken: null, expiresAt: null } });
    await this.scheduler?.removeRecurring(accountId);
    await this.removeTokenRefreshJobs(accountId);
  }

  /** A refresh job for a disconnected account would only fail; drop it. */
  private async removeTokenRefreshJobs(accountId: string) {
    try {
      for (const job of await findPendingAccountJobs(this.tokenQueue, accountId)) await job.remove();
    } catch {
      this.logger.warn(`Could not remove pending token refresh jobs for account ${accountId}`);
    }
  }

  /** Starts OAuth bound to this account; the callback rejects any other seller. */
  async startReconnect(actor: AuthPrincipal, accountId: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({
      where: { id: accountId, tenantId: actor.tenantId }, select: { status: true, externalSellerId: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    if (account.status !== 'DISCONNECTED' || !account.externalSellerId) throw accountConflict('RECONNECT_NOT_ALLOWED');
    return this.oauth.buildAuthorizationUrl(actor, accountId);
  }

  /** Hard delete, only for disconnected accounts with no order history and nothing queued. */
  async remove(tenantId: string, accountId: string) {
    const account = await this.prisma.marketplaceAccount.findFirst({ where: { id: accountId, tenantId }, select: { status: true } });
    if (!account) throw new NotFoundException('Account not found');
    if (account.status !== 'DISCONNECTED') throw accountConflict('ACCOUNT_NOT_DISCONNECTED');
    if (await this.prisma.order.count({ where: { tenantId, marketplaceAccountId: accountId } }) > 0) throw accountConflict('ACCOUNT_HAS_ORDERS');
    const [syncJobs, tokenJobs] = await Promise.all([
      findPendingAccountJobs(this.syncQueue, accountId),
      findPendingAccountJobs(this.tokenQueue, accountId),
    ]);
    if (syncJobs.length + tokenJobs.length > 0) throw accountConflict('ACCOUNT_HAS_PENDING_JOBS');
    // A reconnect may have re-activated the account between the checks and here; only delete while still disconnected.
    const deleted = await this.prisma.marketplaceAccount.deleteMany({ where: { id: accountId, tenantId, status: 'DISCONNECTED' } });
    if (deleted.count === 0) throw accountConflict('ACCOUNT_NOT_DISCONNECTED');
    await this.scheduler?.removeRecurring(accountId);
  }

  async scheduleInitialSync(accountId: string, tenantId: string) {
    await this.scheduleOrdersSync(accountId, tenantId, 'initial-sync');
  }

  async triggerOrdersSync(tenantId: string, accountId: string) {
    await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId },
    });

    await this.scheduleOrdersSync(accountId, tenantId, 'sync-account-orders');
  }

  private async scheduleOrdersSync(
    accountId: string,
    tenantId: string,
    jobName: 'initial-sync' | 'sync-account-orders',
  ) {
    try {
      await this.syncQueue.add(
        jobName,
        { tenantId, accountId },
        { attempts: 5, backoff: { type: 'exponential', delay: 2000 } },
      );
    } catch (error) {
      this.logger.warn(`Queue unavailable for ${jobName}; running sync inline for account ${accountId}`);
      await this.ordersSync.syncRecentOrders(accountId, tenantId);
    }
  }
}
