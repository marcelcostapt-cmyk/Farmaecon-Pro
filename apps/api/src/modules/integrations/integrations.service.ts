import { publicAccountSelect } from '../../shared/security/public-selects';
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_MARKETPLACE_SYNC } from '../../shared/queue/queue.module';
import { MlOrdersSyncService } from './ml-orders-sync.service';

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_MARKETPLACE_SYNC) private readonly syncQueue: Queue,
    private readonly ordersSync: MlOrdersSyncService,
  ) {}

  async findAll(tenantId: string) {
    const accounts = await this.prisma.marketplaceAccount.findMany({
      where: { tenantId },
      select: {
        ...publicAccountSelect,
        source: true, lastSyncedAt: true,
        _count: { select: { orders: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    return accounts.map((acc) => ({
      ...acc,
      orderCount: acc._count.orders,
      status: acc.status,

    }));
  }

  async disconnect(tenantId: string, accountId: string) {
    // Verify ownership before deleting
    await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId },
    });
    await this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId }, data: { status: 'DISCONNECTED', accessToken: null, refreshToken: null, expiresAt: null } });
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
