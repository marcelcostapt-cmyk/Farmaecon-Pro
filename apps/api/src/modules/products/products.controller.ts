import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ProductsService } from './products.service';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { IsString, IsNumber, IsPositive } from 'class-validator';

class UpsertProductDto {
  @IsString() sku: string;
  @IsString() title: string;
  @IsNumber() @IsPositive() costPrice: number;
  @IsNumber() @IsPositive() basePrice: number;
}

@UseGuards(AuthGuard('jwt'))
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  async findAll(
    @CurrentTenant() tenantId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) {
    const result = await this.productsService.findAll(tenantId, { page, limit, search });
    return ok(result.products, { total: result.total, page: result.page, limit: result.limit });
  }

  @Post()
  async upsert(@CurrentTenant() tenantId: string, @Body() dto: UpsertProductDto) {
    const product = await this.productsService.upsert(tenantId, dto);
    return ok(product);
  }
}
