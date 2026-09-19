import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp } from './marketplace-http.service';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';
import { MarketplaceSyncProcessor } from './marketplace-sync.processor';
import { MlApiService } from './ml-api.service';
import { MlOAuthService } from './ml-oauth.service';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { TokenRefreshProcessor } from './token-refresh.processor';
import { QUEUE_MARKETPLACE_SYNC, QUEUE_TOKEN_REFRESH } from '../../shared/queue/queue.module';

@Module({
  imports: [
    BullModule.registerQueue(
      { name: QUEUE_MARKETPLACE_SYNC },
      { name: QUEUE_TOKEN_REFRESH },
    ),
  ],
  controllers: [IntegrationsController],
  providers: [
    TokenVault, MarketplaceHttp, IntegrationsService,
    MlApiService,
    MlOAuthService,
    MlOrdersSyncService,
    MarketplaceSyncProcessor,
    TokenRefreshProcessor,
  ],
  exports: [IntegrationsService, MlOAuthService],
})
export class IntegrationsModule {}
