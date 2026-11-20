import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentTenant, CurrentUser } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import type { AuthPrincipal } from '../auth/auth.service';
import { VALIDITY_STATUSES, type ValidityStatus } from '../costs/lot-validity';
import { CreateLotDto, UpdateLotDto } from './lots.dto';
import { LotsService } from './lots.service';

/** Lotes e validades (cadastro). Leitura para o tenant; escrita só ADMIN. */
@UseGuards(AuthGuard('jwt'))
@Controller('lots')
export class LotsController {
  constructor(private readonly service: LotsService) {}

  @Get()
  async list(@CurrentTenant() tenantId: string, @Query('product') product?: string, @Query('status') status?: string) {
    if (status !== undefined && status !== '' && !VALIDITY_STATUSES.includes(status as ValidityStatus))
      throw new BadRequestException('status inválido.');
    const filter = {
      product: product || undefined,
      status: status ? (status as ValidityStatus) : undefined,
    };
    return ok(await this.service.list(tenantId, new Date(), filter));
  }

  @Post()
  async create(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenantId: string, @Body() dto: CreateLotDto) {
    this.ensureAdmin(user);
    return ok(await this.service.create(tenantId, user.sub ?? null, dto));
  }

  @Patch(':id')
  async update(@CurrentUser() user: AuthPrincipal, @CurrentTenant() tenantId: string, @Param('id') id: string, @Body() dto: UpdateLotDto) {
    this.ensureAdmin(user);
    return ok(await this.service.update(tenantId, id, dto));
  }

  private ensureAdmin(user: AuthPrincipal) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode alterar lotes.');
  }
}
