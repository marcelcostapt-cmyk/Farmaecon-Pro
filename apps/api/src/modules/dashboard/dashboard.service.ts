import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';

export interface DashboardSummary {
  grossRevenue: number | null;
  netProfit: number | null;
  netMarginPct: number | null;
  orderCount: number;
  avgTicket: number | null;
  activeAccounts: number;
  lowStockItems: number;
  pendingOrders: number;
}

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(tenantId: string, from: Date, to: Date): Promise<DashboardSummary> {
    const [transactions, orderCount, paidOrderAggregate, activeAccounts, pendingOrders, products] =
      await Promise.all([
        this.prisma.financialTransaction.findMany({
          where: {
            tenantId,
            date: { gte: from, lte: to },
          },
          select: {
            amount: true,
            type: true,
          },
        }),
        this.prisma.order.count({
          where: {
            tenantId,
            createdAt: { gte: from, lte: to },
          },
        }),
        this.prisma.order.aggregate({
          where: {
            tenantId,
            createdAt: { gte: from, lte: to },
            status: { in: ['PAID', 'SHIPPED', 'DELIVERED'] },
          },
          _avg: { totalAmount: true },
        }),
        this.prisma.marketplaceAccount.count({
          where: {
            tenantId,
            status: { in: ['ACTIVE', 'WARNING'] },
          },
        }),
        this.prisma.order.count({
          where: {
            tenantId,
            status: 'PENDING',
          },
        }),
        this.prisma.product.findMany({
          where: {
            tenantId,
          },
          select: {
            stockQuantity: true,
            minStockQuantity: true,
          },
        }),
      ]);

    const lowStockItems = products.filter(
      (product) => product.stockQuantity <= product.minStockQuantity,
    ).length;

    const totals = transactions.reduce(
      (acc, transaction) => {
        acc[transaction.type] = (acc[transaction.type] ?? 0) + Number(transaction.amount);
        return acc;
      },
      {} as Record<string, number>,
    );

    const grossRevenue = totals.REVENUE ?? null;
    const netProfit = null;

    return {
      grossRevenue,
      netProfit,
      netMarginPct: null,
      orderCount,
      avgTicket: paidOrderAggregate._avg.totalAmount === null ? null : Number(paidOrderAggregate._avg.totalAmount.toFixed(2)),
      activeAccounts,
      lowStockItems,
      pendingOrders,
    };
  }
}
