import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { AllocationRuleType, CostLifecycle, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { money } from '../costs/cost-money';
import {
  applyBonusAllocation,
  type BonusAllocationLine,
  type BonusDecision,
  type AllocationLineResult,
} from '../costs/bonus-allocation';
import { resolveValidFrom } from './cost-validity';

type Actor = { sub?: string } | null;

// Decisão #2 → tipo de regra persistido.
const RULE_MAP: Record<BonusDecision['rule'], AllocationRuleType> = {
  PROPORTIONAL: AllocationRuleType.PROPORTIONAL_SPREAD,
  IGNORE: AllocationRuleType.ZERO_BONUS,
  SPECIFIC_SKU: AllocationRuleType.MANUAL,
};

@Injectable()
export class CostPublicationService {
  private readonly logger = new Logger(CostPublicationService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Aplica a decisão de bonificação ao documento (recalcula e grava custo por linha),
   * mantendo-o em PENDING_REVIEW. Persiste um CostAllocationRule RASCUNHO (approvedAt=null)
   * que o publishCosts aprovará; reaplicar substitui o rascunho (não acumula). NÃO publica.
   */
  async applyBonus(
    tenantId: string,
    invoiceId: string,
    decision: BonusDecision,
    actor: Actor,
  ): Promise<{ invoiceId: string; items: AllocationLineResult[] }> {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { id: true, documentTotal: true },
    });
    if (!invoice) throw new NotFoundException('Documento não encontrado');

    const items = await this.prisma.purchaseInvoiceItem.findMany({
      where: { tenantId, purchaseInvoiceId: invoiceId },
      select: {
        id: true, lineNumber: true, ean: true, marketplaceSku: true, supplierCode: true,
        quantity: true, totalLine: true, isBonus: true, bonusQuantity: true,
      },
    });
    const lines: BonusAllocationLine[] = items.map((i) => ({
      lineNumber: i.lineNumber, ean: i.ean, marketplaceSku: i.marketplaceSku, supplierCode: i.supplierCode,
      quantity: i.quantity ?? money('0'), totalLine: i.totalLine ?? money('0'),
      isBonus: i.isBonus, bonusQuantity: i.bonusQuantity ?? money('0'),
    }));
    const results = applyBonusAllocation(lines, invoice.documentTotal ?? money('0'), decision);
    const byLine = new Map(results.map((r) => [r.lineNumber, r]));

    await this.prisma.$transaction(async (tx) => {
      for (const item of items) {
        const r = byLine.get(item.lineNumber)!;
        await tx.purchaseInvoiceItem.updateMany({
          where: { id: item.id, tenantId },
          data: { unitCostApproved: r.unitCostApproved, allocatedBonus: r.allocatedBonus, bonusQuantity: r.bonusQuantity },
        });
      }
      await tx.purchaseInvoice.updateMany({
        where: { id: invoiceId, tenantId },
        data: { hasBonus: decision.hasBonus, bonusAmount: decision.hasBonus ? decision.bonusAmount : null },
      });
      await tx.costAllocationRule.deleteMany({ where: { tenantId, purchaseInvoiceId: invoiceId, approvedAt: null } });
      await tx.costAllocationRule.create({
        data: {
          tenantId, purchaseInvoiceId: invoiceId, ruleType: RULE_MAP[decision.rule],
          parameters: {
            rule: decision.rule, bonusAmount: decision.bonusAmount.toString(), specificSkuEan: decision.specificSkuEan ?? null,
          } as unknown as Prisma.InputJsonValue,
          approvedBy: null, approvedAt: null,
        },
      });
    });

    return { invoiceId, items: results };
  }

  /**
   * Aprova e publica: grava product_costs APPROVED a partir do custo já calculado,
   * aprova o rascunho de regra e marca o documento APPROVED. Guardas: só a partir de
   * PENDING_REVIEW, documento com conta vinculada, e nunca custo <= 0. Transacional.
   */
  async publishCosts(
    tenantId: string,
    invoiceId: string,
    actor: Actor,
  ): Promise<{
    invoiceId: string; ruleType: AllocationRuleType; publishedCount: number;
    costs: { ean: string | null; sku: string | null; unitCost: string }[];
  }> {
    return this.prisma.$transaction(async (tx) => {
      const invoice = await tx.purchaseInvoice.findFirst({
        where: { id: invoiceId, tenantId },
        select: { id: true, status: true, marketplaceAccountId: true, issuedAt: true, createdAt: true },
      });
      if (!invoice) throw new NotFoundException('Documento não encontrado');
      if (invoice.status !== CostLifecycle.PENDING_REVIEW) {
        throw new BadRequestException('Documento não está em revisão (já publicado?).');
      }
      if (!invoice.marketplaceAccountId) {
        throw new BadRequestException('Documento sem conta ML vinculada; vincule antes de publicar.');
      }
      const draft = await tx.costAllocationRule.findFirst({
        where: { tenantId, purchaseInvoiceId: invoiceId, approvedAt: null },
        select: { id: true, ruleType: true },
      });
      if (!draft) throw new BadRequestException('Aplique a bonificação (regra) antes de publicar.');

      const items = await tx.purchaseInvoiceItem.findMany({
        where: { tenantId, purchaseInvoiceId: invoiceId },
        select: { id: true, ean: true, marketplaceSku: true, supplierCode: true, description: true, unitCostApproved: true },
      });
      const publishable = items.filter((i) => i.unitCostApproved !== null && i.unitCostApproved !== undefined);
      if (publishable.length === 0) throw new BadRequestException('Nenhum custo aprovado para publicar.');
      for (const i of publishable) {
        if (!i.unitCostApproved!.gt(0)) throw new BadRequestException('Custo inválido (<= 0) não pode ser publicado.');
      }

      await tx.costAllocationRule.updateMany({
        where: { id: draft.id, tenantId },
        data: { approvedBy: actor?.sub ?? null, approvedAt: new Date() },
      });
      const validFrom = resolveValidFrom(invoice);
      const costs: { ean: string | null; sku: string | null; unitCost: string }[] = [];
      for (const i of publishable) {
        await tx.productCost.create({
          data: {
            tenantId, marketplaceAccountId: invoice.marketplaceAccountId,
            ean: i.ean, sku: i.marketplaceSku, supplierCode: i.supplierCode, description: i.description,
            unitCost: i.unitCostApproved!, isEstimate: false,
            sourceInvoiceItemId: i.id, costAllocationRuleId: draft.id,
            validFrom, status: CostLifecycle.APPROVED, createdBy: actor?.sub ?? null,
          },
        });
        await tx.purchaseInvoiceItem.updateMany({ where: { id: i.id, tenantId }, data: { allocationRuleId: draft.id } });
        costs.push({ ean: i.ean, sku: i.marketplaceSku, unitCost: i.unitCostApproved!.toString() });
      }
      await tx.purchaseInvoice.updateMany({ where: { id: invoiceId, tenantId }, data: { status: CostLifecycle.APPROVED } });

      this.logger.log(JSON.stringify({ event: 'dre.costs_published', tenantId, invoiceId, ruleType: draft.ruleType, publishedCount: publishable.length }));
      return { invoiceId, ruleType: draft.ruleType, publishedCount: publishable.length, costs };
    });
  }
}
