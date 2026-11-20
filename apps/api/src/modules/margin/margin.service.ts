import { Injectable, BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { normalizeDescription, type CostPoolEntry } from '../costs/cost-matching';
import {
  computeMarginPreview,
  computeMarginAlerts,
  type GroupBy,
  type MarginAlert,
  type MarginOrderRow,
  type MarginPreview,
  type MarginRuleRow,
} from '../costs/margin-preview';
import { rankMarginLines, type MarginRanking } from '../costs/margin-ranking';
import { computeFeeChanges, type FeeChange } from '../costs/fee-change';

export interface MarginFilters {
  accountId?: string;
  start?: Date;
  end?: Date;
  groupBy: GroupBy;
}

export interface RuleInput {
  sku: string | null;
  minMarginPercent: Prisma.Decimal | null;
  minMarginAmount: Prisma.Decimal | null;
}

/**
 * Gestor de Margem por SKU (WeStack) — SÓ LEITURA sobre dados reais. Custo vem de
 * product_costs APPROVED; taxas ML de order_items.saleFee; receita de unitPrice×qty.
 * Nunca altera preços/anúncios/estoque nem chama o ML. Nunca fabrica número.
 */
@Injectable()
export class MarginService {
  constructor(private readonly prisma: PrismaService) {}

  /** Acervo de custos publicados (product_costs APPROVED) como pool de matching. */
  private async approvedCostPool(tenantId: string, accountId?: string): Promise<CostPoolEntry[]> {
    const costs = await this.prisma.productCost.findMany({
      where: { tenantId, status: 'APPROVED', ...(accountId ? { marketplaceAccountId: accountId } : {}) },
    });
    return costs.map((c) => ({
      ean: c.ean,
      marketplaceSku: c.sku,
      supplierCode: c.supplierCode,
      description: c.description,
      normalizedDescription: normalizeDescription(c.description),
      costDate: c.validFrom,
      sourceType: 'manual',
      sourceDocument: 'product_costs',
      sourceLine: c.id,
      sourceHash: c.id,
      allocationRuleId: c.costAllocationRuleId, // APPROVED exige regra (CHECK) → não-nulo
      approvalStatus: 'approved',
      isBonus: false,
      candidates: [{ ruleKey: 'publicado', unitCost: new Prisma.Decimal(c.unitCost), formula: 'custo publicado' }],
    }));
  }

  private async loadRows(tenantId: string, filters: MarginFilters): Promise<MarginOrderRow[]> {
    const where: Record<string, unknown> = { tenantId };
    if (filters.accountId) where.marketplaceAccountId = filters.accountId;
    if (filters.start || filters.end)
      where.createdAt = { ...(filters.start ? { gte: filters.start } : {}), ...(filters.end ? { lte: filters.end } : {}) };

    const orders = await this.prisma.order.findMany({ where });
    const rows: MarginOrderRow[] = [];
    for (const o of orders) {
      const items = await this.prisma.orderItem.findMany({ where: { tenantId, orderId: o.id } });
      rows.push({
        orderId: o.id,
        accountId: o.marketplaceAccountId,
        soldAt: o.mlDateCreated ?? o.createdAt,
        items: items.map((i) => ({
          sku: i.sellerSkuRaw ?? null,
          description: i.title ?? null,
          quantity: i.quantity,
          unitPrice: new Prisma.Decimal(i.unitPrice),
          saleFee: i.saleFee === null ? null : new Prisma.Decimal(i.saleFee),
        })),
      });
    }
    return rows;
  }

  async preview(tenantId: string, filters: MarginFilters): Promise<MarginPreview> {
    const [rows, pool] = await Promise.all([this.loadRows(tenantId, filters), this.approvedCostPool(tenantId, filters.accountId)]);
    return computeMarginPreview(rows, pool, undefined, filters.groupBy);
  }

  /** Heróis (maior margem %) e vilões (menor margem %) por SKU, sobre o mesmo cálculo do preview. */
  async ranking(tenantId: string, filters: Omit<MarginFilters, 'groupBy'>): Promise<MarginRanking> {
    const [rows, pool] = await Promise.all([
      this.loadRows(tenantId, { ...filters, groupBy: 'sku' }),
      this.approvedCostPool(tenantId, filters.accountId),
    ]);
    return rankMarginLines(computeMarginPreview(rows, pool, undefined, 'sku').lines);
  }

  /** Variações de taxa ML por SKU entre os dois últimos meses com dados (≥ 2 pp). Só leitura. */
  async feeChanges(tenantId: string, filters: Omit<MarginFilters, 'groupBy'>): Promise<FeeChange[]> {
    const rows = await this.loadRows(tenantId, { ...filters, groupBy: 'sku' });
    return computeFeeChanges(rows);
  }

  async alerts(tenantId: string, filters: MarginFilters): Promise<MarginAlert[]> {
    const [rows, pool, rules] = await Promise.all([
      this.loadRows(tenantId, { ...filters, groupBy: 'sku' }),
      this.approvedCostPool(tenantId, filters.accountId),
      this.prisma.marginRule.findMany({ where: { tenantId } }),
    ]);
    const ruleRows: MarginRuleRow[] = rules.map((r) => ({
      sku: r.sku,
      minMarginPercent: r.minMarginPercent === null ? null : new Prisma.Decimal(r.minMarginPercent),
      minMarginAmount: r.minMarginAmount === null ? null : new Prisma.Decimal(r.minMarginAmount),
    }));
    return computeMarginAlerts(rows, pool, ruleRows, undefined);
  }

  async listRules(tenantId: string) {
    return this.prisma.marginRule.findMany({ where: { tenantId }, orderBy: [{ sku: 'asc' }] });
  }

  /** Cria/atualiza a regra de margem (global quando sku=null). Exige pelo menos um limite. */
  async upsertRule(tenantId: string, actor: { sub?: string } | null, input: RuleInput) {
    if (input.minMarginPercent === null && input.minMarginAmount === null) {
      throw new BadRequestException('Defina pelo menos um limite (percentual ou valor).');
    }
    const data = {
      minMarginPercent: input.minMarginPercent,
      minMarginAmount: input.minMarginAmount,
      createdBy: actor?.sub ?? null,
    };
    const existing = await this.prisma.marginRule.findFirst({ where: { tenantId, sku: input.sku } });
    if (existing) {
      await this.prisma.marginRule.updateMany({ where: { id: existing.id, tenantId }, data });
      return { id: existing.id, sku: input.sku, updated: true };
    }
    const created = await this.prisma.marginRule.create({ data: { tenantId, sku: input.sku, ...data }, select: { id: true } });
    return { id: created.id, sku: input.sku, updated: false };
  }
}
