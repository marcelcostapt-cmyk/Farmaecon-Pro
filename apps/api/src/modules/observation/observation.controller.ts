import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { ObservationService } from './observation.service';
@UseGuards(AuthGuard('jwt'))
@Controller('observation')
export class ObservationController {
  constructor(private readonly service: ObservationService) {}
  @Get('report')
  async report(@CurrentTenant() tenantId: string, @Query('from') from?: string, @Query('to') to?: string) {
    const now = new Date();
    return ok(await this.service.report(tenantId, from ? new Date(from) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), to ? new Date(to) : now));
  }
}
