import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { DashboardService } from './dashboard.service';

@UseGuards(AuthGuard('jwt'))
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  async getSummary(
    @CurrentTenant() tenantId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const now = new Date();
    const rangeFrom = from ? new Date(from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const rangeTo = to ? new Date(to) : now;

    const summary = await this.dashboardService.getSummary(tenantId, rangeFrom, rangeTo);
    return ok(summary);
  }
}
