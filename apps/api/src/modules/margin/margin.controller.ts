import { Body, Controller, ForbiddenException, Get, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import type { AuthPrincipal } from '../auth/auth.service';
import { ok } from '../../shared/types/api-response.type';
import { toJsonSafe } from '../costs/decimal-json';
import { money } from '../costs/cost-money';
import type { GroupBy } from '../costs/margin-preview';
import { MarginService } from './margin.service';

const GROUP_BY: GroupBy[] = ['sku', 'day', 'month'];
const DECIMAL = /^\d+(\.\d+)?$/;

class UpsertRuleDto {
  @IsOptional() @IsString() sku?: string | null;
  @IsOptional() @Matches(DECIMAL, { message: 'minMarginPercent inválido' }) minMarginPercent?: string;
  @IsOptional() @Matches(DECIMAL, { message: 'minMarginAmount inválido' }) minMarginAmount?: string;
}

/** Gestor de Margem (WeStack) — só leitura/configuração; nunca altera o Mercado Livre. */
@UseGuards(AuthGuard('jwt'))
@Controller('margin')
export class MarginController {
  constructor(private readonly service: MarginService) {}

  @Get('preview')
  async preview(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('group_by') groupBy?: string,
  ) {
    const gb: GroupBy = GROUP_BY.includes(groupBy as GroupBy) ? (groupBy as GroupBy) : 'sku';
    const result = await this.service.preview(tenantId, {
      accountId: accountId || undefined,
      start: startDate ? new Date(startDate) : undefined,
      end: endDate ? new Date(endDate) : undefined,
      groupBy: gb,
    });
    return ok(toJsonSafe(result));
  }

  @Get('alerts')
  async alerts(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const result = await this.service.alerts(tenantId, {
      accountId: accountId || undefined,
      start: startDate ? new Date(startDate) : undefined,
      end: endDate ? new Date(endDate) : undefined,
      groupBy: 'sku',
    });
    return ok(toJsonSafe(result));
  }

  @Get('ranking')
  async ranking(
    @CurrentTenant() tenantId: string,
    @Query('account_id') accountId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const result = await this.service.ranking(tenantId, {
      accountId: accountId || undefined,
      start: startDate ? new Date(startDate) : undefined,
      end: endDate ? new Date(endDate) : undefined,
    });
    return ok(toJsonSafe(result));
  }

  @Get('rules')
  async listRules(@CurrentTenant() tenantId: string) {
    return ok(toJsonSafe(await this.service.listRules(tenantId)));
  }

  @Put('rules')
  async upsertRule(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenantId: string, @Body() dto: UpsertRuleDto) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode definir regras de margem.');
    const sku = dto.sku == null || dto.sku.trim() === '' ? null : dto.sku.trim();
    return ok(
      await this.service.upsertRule(tenantId, { sub: user.sub }, {
        sku,
        minMarginPercent: dto.minMarginPercent == null ? null : money(dto.minMarginPercent),
        minMarginAmount: dto.minMarginAmount == null ? null : money(dto.minMarginAmount),
      }),
    );
  }
}
