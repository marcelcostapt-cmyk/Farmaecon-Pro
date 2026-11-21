import { BadRequestException, Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { toJsonSafe } from '../costs/decimal-json';
import { DrePreviewService } from './dre-preview.service';
import type { GroupBy } from '../costs/dre-preview';
import { DEFAULT_EXPIRY_WINDOW_DAYS } from '../costs/lot-expiry';

const GROUP_BY: GroupBy[] = ['day', 'month', 'product'];
const MAX_EXPIRY_WINDOW_DAYS = 365;

@UseGuards(AuthGuard('jwt'))
@Controller('dre')
export class DrePreviewController {
  constructor(private readonly service: DrePreviewService) {}

  // CMV indicativo de um pedido (preview; nunca persistido).
  @Get('orders/:id/cmv-preview')
  async orderCmvPreview(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    return ok(toJsonSafe(await this.service.orderCmvPreview(tenantId, id)));
  }

  // Lotes vencidos ou a vencer (leitura). days = janela em dias (0–365, default 90).
  @Get('lots/expiring')
  async expiringLots(@CurrentTenant() tenantId: string, @Query('days') days?: string) {
    const raw = days ?? String(DEFAULT_EXPIRY_WINDOW_DAYS);
    const windowDays = Number(raw);
    if (!/^\d{1,3}$/.test(raw) || windowDays > MAX_EXPIRY_WINDOW_DAYS) {
      throw new BadRequestException(`days deve ser um inteiro entre 0 e ${MAX_EXPIRY_WINDOW_DAYS}.`);
    }
    return ok(toJsonSafe(await this.service.expiringLots(tenantId, new Date(), windowDays)));
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
