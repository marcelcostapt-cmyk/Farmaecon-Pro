import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

export const QUEUE_MARKETPLACE_SYNC = 'marketplace-sync';
export const QUEUE_STOCK_SYNC = 'stock-sync';
export const QUEUE_TOKEN_REFRESH = 'token-refresh';
export const QUEUE_NOTIFICATIONS = 'notifications';
export const QUEUE_REPORTS = 'reports';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          maxRetriesPerRequest: null, // Required by BullMQ
          enableReadyCheck: false,
        },
        defaultJobOptions: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 5000 },
        },
      }),
    }),
    BullModule.registerQueue(
      { name: QUEUE_MARKETPLACE_SYNC },
      { name: QUEUE_STOCK_SYNC },
      { name: QUEUE_TOKEN_REFRESH },
      { name: QUEUE_NOTIFICATIONS },
      { name: QUEUE_REPORTS },
    ),
  ],
  exports: [BullModule],
})
export class QueueModule {}
