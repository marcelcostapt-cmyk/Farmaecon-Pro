import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { MarketplacePlatform } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_MARKETPLACE_SYNC } from '../../shared/queue/queue.module';
import { MlOrdersSyncService } from './ml-orders-sync.service';

/** Recurring read-only order sync interval. Keep at or above 10 minutes. */
export const RECURRING_SYNC_INTERVAL_MS = 15 * 60 * 1000;
export const SCHEDULED_SYNC_JOB = 'scheduled-sync-account-orders';

/** Jobs in these states mean a pass (or its page chain) is already in flight. */
const IN_FLIGHT_STATES = ['active', 'waiting', 'delayed', 'prioritized', 'waiting-children'] as const;

interface SyncJobData {
  tenantId: string;
  accountId: string;
}

export type ScheduledTickOutcome = 'SYNCED' | 'SKIPPED_IN_FLIGHT' | 'UNSCHEDULED';

/**
 * Tenant RLS hides accounts and tenants from a global query, so the tenant
 * travels with a per-account BullMQ job scheduler instead of a global cron.
 * Redis owns the schedule: it survives restarts and fires once per interval
 * even with several API replicas.
 */
@Injectable()
export class MarketplaceSyncScheduler {
  private readonly logger = new Logger(MarketplaceSyncScheduler.name);

  constructor(
    @InjectQueue(QUEUE_MARKETPLACE_SYNC) private readonly queue: Queue,
    private readonly prisma: PrismaService,
    private readonly ordersSync: MlOrdersSyncService,
  ) {}

  static schedulerId(accountId: string): string {
    // Stable per account: upserting again keeps one schedule and its cadence.
    return `orders-sync-${accountId}`;
  }

  /** Idempotent: re-registering keeps a single schedule per account. */
  async ensureRecurring(tenantId: string, accountId: string): Promise<void> {
    if (!tenantId || !accountId) throw new Error('Account and tenant are required');
    await this.queue.upsertJobScheduler(
      MarketplaceSyncScheduler.schedulerId(accountId),
      { every: RECURRING_SYNC_INTERVAL_MS },
      {
        name: SCHEDULED_SYNC_JOB,
        data: { tenantId, accountId } satisfies SyncJobData,
        opts: {
          // A failed tick is retried by the next tick; page continuations keep their own retries.
          attempts: 1,
          removeOnComplete: 100,
          removeOnFail: 1000,
        },
      },
    );
  }

  async removeRecurring(accountId: string): Promise<void> {
    await this.queue.removeJobScheduler(MarketplaceSyncScheduler.schedulerId(accountId));
  }

  /** Runs inside the job's tenant context (set by the processor). */
  async runScheduledTick(job: Job): Promise<ScheduledTickOutcome> {
    const { tenantId, accountId } = job.data as SyncJobData;

    const account = await this.prisma.marketplaceAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { status: true, platform: true },
    });
    if (!account || account.status !== 'ACTIVE' || account.platform !== MarketplacePlatform.MERCADO_LIVRE) {
      await this.removeRecurring(accountId);
      this.logger.log(`Removed recurring sync for account ${accountId}: no longer an active Mercado Livre account`);
      return 'UNSCHEDULED';
    }

    if (await this.hasInFlightJob(accountId, job.id)) {
      this.logger.debug(`Skipping scheduled sync for account ${accountId}: a sync is already in flight`);
      return 'SKIPPED_IN_FLIGHT';
    }

    await this.ordersSync.syncRecentOrders(accountId, tenantId);
    return 'SYNCED';
  }

  /**
   * Only page-chain jobs count. The scheduler always keeps its own next tick
   * delayed for the same account, so scheduled ticks are excluded.
   */
  private async hasInFlightJob(accountId: string, ownJobId?: string): Promise<boolean> {
    const jobs = await this.queue.getJobs([...IN_FLIGHT_STATES], 0, -1);
    return jobs.some((other) =>
      other
      && other.id !== ownJobId
      && other.name !== SCHEDULED_SYNC_JOB
      && (other.data as SyncJobData | undefined)?.accountId === accountId);
  }
}
