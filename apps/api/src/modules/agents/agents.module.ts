import { Module } from '@nestjs/common';
import { MarginModule } from '../margin/margin.module';
import { AgentsController } from './agents.controller';
import { AgentsService } from './agents.service';

@Module({
  imports: [MarginModule],
  controllers: [AgentsController],
  providers: [AgentsService],
})
export class AgentsModule {}
