import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { OrdersService } from './orders.service';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';

@UseGuards(AuthGuard('jwt'))
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('status') status?: string,
  ) {
    const result = await this.ordersService.findAll(tenantId, { page, limit, status });
    return ok(result.orders, { total: result.total, page: result.page, limit: result.limit });
  }

  @Get(':id')
  async findOne(@CurrentTenant() tenantId: string, @Param('id') id: string) {
    const order = await this.ordersService.findOne(tenantId, id);
    return ok(order);
  }
}
