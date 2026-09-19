import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { MlOAuthService } from '../integrations/ml-oauth.service';
import { QUEUE_TOKEN_REFRESH } from '../../shared/queue/queue.module';

@Processor(QUEUE_TOKEN_REFRESH)
export class TokenRefreshProcessor extends WorkerHost {
  private readonly logger = new Logger(TokenRefreshProcessor.name);

  constructor(private readonly mlOAuth: MlOAuthService) {
    super();
  }

  async process(job: Job): Promise<void> {
    const { accountId, tenantId } = job.data as { accountId: string; tenantId: string };
    this.logger.log(`Processing token refresh for account: ${accountId}`);
    await this.mlOAuth.refreshToken(accountId, tenantId);
  }
}
