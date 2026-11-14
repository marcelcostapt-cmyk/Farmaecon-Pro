import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger, Optional } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_MARKETPLACE_SYNC } from '../../shared/queue/queue.module';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { inTenant } from '../../shared/prisma/tenant-context';
import { MarketplaceSyncScheduler, SCHEDULED_SYNC_JOB } from './marketplace-sync.scheduler';

@Processor(QUEUE_MARKETPLACE_SYNC)
export class MarketplaceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketplaceSyncProcessor.name);

  constructor(
    private readonly ordersSync: MlOrdersSyncService,
    @Optional() private readonly scheduler?: MarketplaceSyncScheduler,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { accountId, tenantId } = job.data as { accountId: string; tenantId: string };

    switch (job.name) {
      case 'initial-sync':
      case 'sync-account-orders': {
        this.logger.log(`Processing Mercado Livre sync job "${job.name}" for account ${accountId}`);
        const result = await inTenant(tenantId, () => this.ordersSync.syncRecentOrders(accountId, tenantId));
        // A completed pass proves the account syncs; keep it on the recurring schedule.
        if (result?.status === 'COMPLETE' && this.scheduler) {
          await this.scheduler.ensureRecurring(tenantId, accountId);
        }
        return;
      }
      case SCHEDULED_SYNC_JOB: {
        if (!this.scheduler) throw new Error('Recurring sync scheduler unavailable');
        const scheduler = this.scheduler;
        const outcome = await inTenant(tenantId, () => scheduler.runScheduledTick(job));
        this.logger.log(`Scheduled sync tick for account ${accountId}: ${outcome}`);
        return;
      }
      default:
        this.logger.warn(`Ignoring unknown marketplace sync job "${job.name}"`);
    }
  }
}
