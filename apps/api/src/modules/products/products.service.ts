import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, params: { page?: number; limit?: number; search?: string }) {
    const { page = 1, limit = 50, search } = params;
    const skip = (page - 1) * limit;

    const where: Prisma.ProductWhereInput = {
      tenantId,
      ...(search ? { title: { contains: search } } : {}),
    };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      this.prisma.product.count({ where }),
    ]);

    return { products, total, page, limit };
  }

  async upsert(tenantId: string, data: { sku: string; title: string; costPrice: number; basePrice: number }) {
    return this.prisma.product.upsert({
      where: { tenantId_sku: { tenantId, sku: data.sku } },
      update: { title: data.title, costPrice: data.costPrice, basePrice: data.basePrice },
      create: { tenantId, ...data },
    });
  }

  /** Calcula margem de contribuição por SKU */
  calculateMargin(basePrice: number, costPrice: number, commissionRate: number, shippingCost: number): {
    grossMargin: number;
    netMargin: number;
    grossMarginPct: number;
  } {
    const commission = basePrice * (commissionRate / 100);
    const grossProfit = basePrice - commission - costPrice;
    const netProfit = grossProfit - shippingCost;
    return {
      grossMargin: grossProfit,
      netMargin: netProfit,
      grossMarginPct: (grossProfit / basePrice) * 100,
    };
  }
}
