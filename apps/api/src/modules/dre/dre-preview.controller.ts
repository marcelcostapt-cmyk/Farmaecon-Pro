import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { toJsonSafe } from '../costs/decimal-json';
import { DrePreviewService } from './dre-preview.service';
import type { GroupBy } from '../costs/dre-preview';

const GROUP_BY: GroupBy[] = ['day', 'month', 'product'];

@UseGuards(AuthGuard('jwt'))
@Controller('dre')
export class DrePreviewController {
  constructor(private readonly service: DrePreviewService) {}

  // CMV indicativo de um pedido (preview; nunca persistido).
  @Get('orders/:id/cmv-preview')
  async orderCmvPreview(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return ok(toJsonSafe(await this.service.orderCmvPreview(tenantId, id)));
  }

  // Demonstração do DRE (preview). group_by: day | month | product.
  @Get('preview')
  async drePreview(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('group_by') groupBy?: string,
  ) {
    const gb: GroupBy = GROUP_BY.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : 'day';
    const dre = await this.service.drePreview(tenantId, {
      accountId: accountId || undefined,
      start: startDate ? new Date(startDate) : undefined,
      end: endDate ? new Date(endDate) : undefined,
      groupBy: gb,
    });
    return ok(toJsonSafe(dre));
  }
}
