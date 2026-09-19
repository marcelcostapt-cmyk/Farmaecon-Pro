import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { QUEUE_MARKETPLACE_SYNC } from '../../shared/queue/queue.module';
import { MlOrdersSyncService } from './ml-orders-sync.service';

@Processor(QUEUE_MARKETPLACE_SYNC)
export class MarketplaceSyncProcessor extends WorkerHost {
  private readonly logger = new Logger(MarketplaceSyncProcessor.name);

  constructor(private readonly ordersSync: MlOrdersSyncService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { accountId, tenantId } = job.data as { accountId: string; tenantId: string };

    switch (job.name) {
      case 'initial-sync':
      case 'sync-account-orders':
        this.logger.log(`Processing Mercado Livre sync job "${job.name}" for account ${accountId}`);
        await this.ordersSync.syncRecentOrders(accountId, tenantId);
        return;
      default:
        this.logger.warn(`Ignoring unknown marketplace sync job "${job.name}"`);
    }
  }
}
