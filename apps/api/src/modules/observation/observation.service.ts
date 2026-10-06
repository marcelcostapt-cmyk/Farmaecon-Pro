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
      id: true, name: true, source: true, lastSyncedAt: true, lastSyncState: true, lastSyncError: true,
      lastSyncAttemptAt: true, status: true,
      syncStates: { where: { operation: 'ORDERS' }, select: {
        status: true, expectedTotal: true, importedCount: true, nextOffset: true,
        completedPages: true, updatedAt: true, lastError: true,
      }, take: 1 },
    }, orderBy: { id: 'asc' } });
    const orders = await this.prisma.order.findMany({ where: { tenantId, createdAt: range }, select: {
      id: true, marketplaceAccountId: true, status: true, totalAmount: true,
    } });
    const gaps = ['Financial reconciliation is unavailable: fees, product costs, shipping, taxes and refunds are not fully imported.',
      'Order totals are not settled revenue. No real DRE or net profit can be inferred.',
      'Financial coverage is not certified; observed order totals must not be treated as settled revenue.'];
    if (accounts.some(a => a.source === 'SIMULATED')) gaps.push('Simulated fixture data: not real marketplace activity.');
    if (!accounts.length || accounts.some(a => a.lastSyncState !== 'COMPLETE' || !a.lastSyncedAt)) gaps.push('At least one source has not completed synchronization.');
    if (accounts.some(a => a.syncStates[0]?.status === 'PARTIAL')) gaps.push('At least one source has partial coverage; the continuation job is still pending.');
    if (accounts.some(a => a.syncStates[0]?.status === 'FAILED')) gaps.push('At least one source has a failed synchronization that requires retry or review.');
    return {
      mode: 'OBSERVATION', agent: { name: 'Observation analyst', version: '1', kind: 'deterministic' },
      generatedAt: new Date().toISOString(), period: { from: from.toISOString(), to: to.toISOString() },
      sources: accounts.map(a => {
        const sync = a.syncStates[0] ?? null;
        return {
          id: a.id,
          name: a.name,
          source: a.source,
          status: a.status,
          lastSyncedAt: a.lastSyncedAt,
          lastSyncAttemptAt: a.lastSyncAttemptAt,
          syncStatus: sync?.status ?? a.lastSyncState ?? 'NOT_STARTED',
          expectedTotal: sync?.expectedTotal ?? null,
          importedCount: sync?.importedCount ?? 0,
          nextOffset: sync?.nextOffset ?? 0,
          completedPages: sync?.completedPages ?? 0,
          syncError: sync?.lastError ?? a.lastSyncError ?? null,
          orderCount: orders.filter(o => o.marketplaceAccountId === a.id).length,
        };
      }),
      orderCount: orders.length, pendingOrderCount: orders.filter(o => o.status === 'PENDING').length,
      observedOrderTotal: orders.length ? orders.reduce((n, o) => n + o.totalAmount, 0) : null,
      financial: { complete: false, grossRevenue: null, netProfit: null, netMarginPct: null },
      gaps, recommendations: ['Review pending orders manually.', 'Complete financial reconciliation before evaluating profitability.'],
    };
  }
}
