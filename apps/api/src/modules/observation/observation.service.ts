import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
export function period(from: Date, to: Date) {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to) throw new BadRequestException('Invalid period');
  return { gte: from, lte: to };
}
@Injectable()
export class ObservationService {
  constructor(private readonly prisma: PrismaService) {}
  async report(tenantId: string, from: Date, to: Date) {
    const range = period(from, to);
    const accounts = await this.prisma.marketplaceAccount.findMany({ where: { tenantId }, select: {
      id: true, name: true, source: true, lastSyncedAt: true, status: true,
      lastSyncState: true, lastSyncAttemptAt: true, lastSyncError: true,
    }, orderBy: { id: 'asc' } });
    const orders = await this.prisma.order.findMany({ where: { tenantId, createdAt: range }, select: {
      id: true, marketplaceAccountId: true, status: true, totalAmount: true,
    } });
    const gaps = ['Financial reconciliation is unavailable: fees, product costs, shipping, taxes and refunds are not fully imported.',
      'Order totals are not settled revenue. No real DRE or net profit can be inferred.',
      'Full period coverage is not certified. Incomplete pagination or invalid order data blocks synchronization instead of importing a partial batch.'];
    if (accounts.some(a => a.source === 'SIMULATED')) gaps.push('Simulated fixture data: not real marketplace activity.');
    if (!accounts.length || accounts.some(a => !a.lastSyncedAt)) gaps.push('At least one source has not completed synchronization.');
    if (accounts.some(a => a.lastSyncState === 'FAILED')) gaps.push('A synchronization failed. Previously imported data may be stale; lastSyncedAt only records a successful batch.');
    const minorTotal = orders.reduce((n, o) => n + BigInt(Math.round(o.totalAmount * 100)), 0n);
    const total = minorTotal <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(minorTotal) / 100 : null;
    if (total === null) gaps.push('Observed order total exceeds the supported display precision.');
    return {
      mode: 'OBSERVATION', agent: { name: 'Observation analyst', version: '1', kind: 'deterministic' },
      generatedAt: new Date().toISOString(), period: { from: from.toISOString(), to: to.toISOString() },
      sources: accounts.map(a => ({ ...a, orderCount: orders.filter(o => o.marketplaceAccountId === a.id).length })),
      orderCount: orders.length, pendingOrderCount: orders.filter(o => o.status === 'PENDING').length,
      observedOrderTotal: orders.length ? total : null,
      financial: { complete: false, grossRevenue: null, netProfit: null, netMarginPct: null },
      gaps, recommendations: ['Review pending orders manually.', 'Complete financial reconciliation before evaluating profitability.'],
    };
  }
}
