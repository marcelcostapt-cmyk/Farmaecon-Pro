import { Module } from '@nestjs/common';
import { ObservationService } from './observation.service';
import { ObservationController } from './observation.controller';
@Module({ providers: [ObservationService], controllers: [ObservationController], exports: [ObservationService] })
export class ObservationModule {}
