import { Module } from '@nestjs/common';
import { MarginController } from './margin.controller';
import { MarginService } from './margin.service';

@Module({
  controllers: [MarginController],
  providers: [MarginService],
  exports: [MarginService],
})
export class MarginModule {}
