import { Module } from '@nestjs/common';
import { AdsModule } from '../ads/ads.module';
import { MarginModule } from '../margin/margin.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [MarginModule, AdsModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
