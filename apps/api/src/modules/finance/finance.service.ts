import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { period } from '../observation/observation.service';
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}
  async getDre(tenantId: string, from: Date, to: Date) {
    const range = period(from, to);
    const transactions = await this.prisma.financialTransaction.findMany({ where: { tenantId, date: range } });
    const orderCount = await this.prisma.order.count({ where: { tenantId, createdAt: range, status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] } } });
    const observed = (type: string) => {
      const found = transactions.filter(t => t.type === type);
      return found.length ? found.reduce((n, t) => n + Number(t.amount), 0) : null;
    };
    return {
      complete: false, status: 'INCOMPLETE', gaps: ['Financial coverage and reconciliation have not been certified. These are partial ledger totals, not a real DRE.'],
      grossRevenue: observed('REVENUE'), marketplaceFees: observed('FEE'), productCosts: observed('PRODUCT_COST'),
      shippingCosts: observed('SHIPPING'), taxes: observed('TAX'), otherExpenses: observed('EXPENSE'),
      grossProfit: null, netProfit: null, netMarginPct: null, orderCount,
    };
  }
  createExpense(tenantId: string, data: { amount: number; description: string; date?: Date }) {
    return this.prisma.financialTransaction.create({ data: { tenantId, amount: data.amount, type: 'EXPENSE', description: data.description, date: data.date ?? new Date() } });
  }
}
