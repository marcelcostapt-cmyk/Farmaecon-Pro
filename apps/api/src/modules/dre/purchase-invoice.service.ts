import { Injectable } from '@nestjs/common';
import { Prisma, PurchaseDocumentSource } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { DocumentSource, UnifiedInvoice } from '../costs/document-parser';

const SOURCE_MAP: Record<DocumentSource, PurchaseDocumentSource> = {
  xml: PurchaseDocumentSource.XML,
  pdf: PurchaseDocumentSource.PDF,
  xlsx: PurchaseDocumentSource.EXCEL,
};

export interface IngestResult {
  invoiceId: string;
  created: boolean;
  itemCount: number;
  // true quando há indícios de itens mas nenhuma linha foi extraída (regra 5.2):
  // o documento fica PENDING_REVIEW e não contribui custo. Nunca concluir com custo zero.
  extractionIncomplete: boolean;
}

@Injectable()
export class PurchaseInvoiceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste o documento extraído como purchase_invoice + itens em status PENDING_REVIEW.
   * NUNCA publica product_costs nem calcula CMV final. Idempotente por (tenant, sha256).
   */
  async ingest(tenantId: string, doc: UnifiedInvoice, createdBy: string | null): Promise<IngestResult> {
    const existing = await this.prisma.purchaseInvoice.findFirst({
      where: { tenantId, fileHashSha256: doc.fileHashSha256 },
      select: { id: true },
    });
    if (existing) {
      const itemCount = await this.prisma.purchaseInvoiceItem.count({
        where: { tenantId, purchaseInvoiceId: existing.id },
      });
      return { invoiceId: existing.id, created: false, itemCount, extractionIncomplete: doc.extractionIncomplete };
    }

    const invoice = await this.prisma.purchaseInvoice.create({
      data: {
        tenantId,
        marketplaceAccountId: null, // vínculo conta↔documento é decisão de negócio #1
        source: SOURCE_MAP[doc.source],
        originalFilename: doc.originalFilename,
        fileHashSha256: doc.fileHashSha256,
        invoiceNumber: doc.invoiceNumber,
        invoiceSeries: doc.invoiceSeries,
        invoiceKey: doc.invoiceKey,
        issuerCnpj: doc.issuerCnpj,
        recipientCnpj: doc.recipientCnpj,
        issuedAt: doc.issuedAt,
        productsTotal: doc.productsTotal,
        otherExpenses: doc.otherExpenses,
        discounts: doc.discounts,
        documentTotal: doc.fiscalTotal,
        paymentAmountInDocument: doc.paymentAmountInDocument,
        hasBonus: doc.hasBonus,
        bonusAmount: doc.bonusAmount,
        paidAmount: doc.paidAmount,
        status: 'PENDING_REVIEW',
        extractionWarnings: doc.warnings as unknown as Prisma.InputJsonValue,
        createdBy,
      },
      select: { id: true },
    });

    for (const l of doc.lines) {
      await this.prisma.purchaseInvoiceItem.create({
        data: {
          tenantId,
          purchaseInvoiceId: invoice.id,
          lineNumber: l.lineNumber,
          sourceRef: l.sourceRef,
          supplierProductCode: l.supplierProductCode,
          ean: l.ean,
          marketplaceSku: l.marketplaceSku,
          description: l.description,
          ncm: l.ncm,
          unit: l.unit,
          quantity: l.quantity,
          unitCostExtracted: l.unitCostExtracted,
          unitCostPaid: l.unitCostPaid,
          totalLine: l.totalLine,
          discount: l.discount,
          otherExpense: l.otherExpense,
          cfop: l.cfop,
          lotNumber: l.lotNumber,
          isBonus: l.isBonus,
          warnings: l.warnings as unknown as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    }

    return { invoiceId: invoice.id, created: true, itemCount: doc.lines.length, extractionIncomplete: doc.extractionIncomplete };
  }
}
