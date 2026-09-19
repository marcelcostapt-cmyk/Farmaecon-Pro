import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FinanceService } from './finance.service';
import { CurrentTenant } from '../../shared/decorators/tenant.decorator';
import { ok } from '../../shared/types/api-response.type';
import { IsNumber, IsPositive, IsOptional, IsString, IsDateString } from 'class-validator';

class CreateExpenseDto {
  @IsNumber() @IsPositive() amount: number;
  @IsString() description: string;
  @IsDateString() @IsOptional() date?: string;
}

@UseGuards(AuthGuard('jwt'))
@Controller('finance')
export class FinanceController {
  constructor(private readonly financeService: FinanceService) {}

  @Get('dre')
  async getDre(
    @CurrentTenant() tenantId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const dre = await this.financeService.getDre(tenantId, new Date(from), new Date(to));
    return ok(dre);
  }

  @Post('expenses')
  async createExpense(@CurrentTenant() tenantId: string, @Body() dto: CreateExpenseDto) {
    const expense = await this.financeService.createExpense(tenantId, {
      ...dto,
      date: dto.date ? new Date(dto.date) : undefined,
    });
    return ok(expense);
  }
}
