import { Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { publicOrderSelect } from '../../shared/security/public-selects';
import { PrismaService } from '../../shared/prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(tenantId: string, params: { page?: number; limit?: number; status?: string }) {
    const page = Math.max(1, Number(params.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(params.limit) || 50));
    const { status } = params;
    const skip = (page - 1) * limit;
    const normalizedStatus = status && status in OrderStatus
      ? OrderStatus[status as keyof typeof OrderStatus]
      : undefined;

    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: publicOrderSelect,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    return { orders, total, page, limit };
  }

  async findOne(tenantId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      select: publicOrderSelect,
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
