import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { Prisma, PurchaseDocumentSource } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { DocumentSource, UnifiedInvoice } from '../costs/document-parser';
import { resolveDocumentAccount, type AccountMatchReason, type MlAccountIdentity } from '../costs/document-account-match';
import { normalizeCnpj, isValidCnpj } from '../../shared/fiscal/cnpj';

const SOURCE_MAP: Record<DocumentSource, PurchaseDocumentSource> = {
  xml: PurchaseDocumentSource.XML,
  pdf: PurchaseDocumentSource.PDF,
  xlsx: PurchaseDocumentSource.EXCEL,
};

export interface AccountMatchInfo {
  reason: AccountMatchReason;
  requiresReview: boolean;
  linkedAccountId: string | null;
  candidates: string[];
}

export interface IngestResult {
  invoiceId: string;
  created: boolean;
  itemCount: number;
  // true quando há indícios de itens mas nenhuma linha foi extraída (regra 5.2):
  // o documento fica PENDING_REVIEW e não contribui custo. Nunca concluir com custo zero.
  extractionIncomplete: boolean;
  // Resultado do vínculo documento→conta (null no caminho de deduplicação).
  accountMatch: AccountMatchInfo | null;
}

@Injectable()
export class PurchaseInvoiceService {
  private readonly logger = new Logger(PurchaseInvoiceService.name);
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste o documento extraído como purchase_invoice + itens em status PENDING_REVIEW,
   * em transação, e resolve o vínculo documento→conta ML (decisões §5). O vínculo é
   * preenchido SÓ quando a associação é confiável (CNPJ válido, exato, único candidato);
   * caso contrário fica null e o caso permanece em revisão. Vincular NÃO publica custo.
   * Idempotente por (tenant, sha256); o índice UNIQUE do BD é a garantia final.
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
      return { invoiceId: existing.id, created: false, itemCount, extractionIncomplete: doc.extractionIncomplete, accountMatch: null };
    }

    // Resolve o vínculo com base no DESTINATÁRIO do documento e nas contas do tenant.
    const accounts = await this.prisma.marketplaceAccount.findMany({
      where: { tenantId },
      select: { id: true, status: true, name: true, cnpj: true, businessName: true },
    });
    const identities: MlAccountIdentity[] = accounts.map((a) => ({
      id: a.id, status: a.status, name: a.name, cnpj: a.cnpj, officialName: a.businessName,
    }));
    const match = resolveDocumentAccount({ recipientCnpj: doc.recipientCnpj, recipientName: null }, identities);
    const linkedAccountId = match.reason === 'cnpj' ? match.accountId : null;

    // Auditoria da decisão do vínculo em extraction_warnings (mantém o shape string[]).
    const auditLine = `Vínculo conta: ${match.reason}${linkedAccountId ? ` → ${linkedAccountId}` : ' (pendente, revisão manual)'}`;
    const warnings = [...doc.warnings, auditLine];

    const invoiceId = await this.prisma.$transaction(async (tx: any) => {
      const invoice = await tx.purchaseInvoice.create({
        data: {
          tenantId,
          marketplaceAccountId: linkedAccountId, // só preenchido em vínculo confiável por CNPJ
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
          extractionWarnings: warnings as unknown as Prisma.InputJsonValue,
          createdBy,
        },
        select: { id: true },
      });
      for (const l of doc.lines) {
        await tx.purchaseInvoiceItem.create({
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
            anvisaRegister: l.anvisaRegister,
            anvisaExemptionReason: l.anvisaExemptionReason,
            pmc: l.pmc,
            ipiAmount: l.ipi,
            icmsStAmount: l.icmsSt,
            fabricationDate: l.fabricationDate === null ? null : new Date(`${l.fabricationDate}T00:00:00.000Z`),
            expiryDate: l.expiryDate === null ? null : new Date(`${l.expiryDate}T00:00:00.000Z`),
            isBonus: l.isBonus,
            warnings: l.warnings as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
      }
      return invoice.id as string;
    });

    this.logger.log(
      JSON.stringify({ event: 'purchase_invoice.ingested', tenantId, invoiceId, createdBy, accountMatch: match.reason, linkedAccountId }),
    );

    return {
      invoiceId,
      created: true,
      itemCount: doc.lines.length,
      extractionIncomplete: doc.extractionIncomplete,
      accountMatch: { reason: match.reason, requiresReview: match.requiresReview, linkedAccountId, candidates: match.candidates },
    };
  }

  /**
   * Seleção MANUAL de conta para um documento. Método de serviço pronto para a UI de
   * revisão (/dre/preview, P6 do DRE increment); o endpoint HTTP ainda NÃO existe —
   * quando for criado TEM de aplicar AdminGuard (ação de gestão). Já aqui confirma a
   * compatibilidade fiscal: se o documento tem CNPJ de destinatário válido, a conta
   * escolhida TEM de ter o mesmo CNPJ — um id enviado pelo cliente não contorna esta
   * verificação. Escopo por tenant em leitura e escrita.
   */
  async associateAccountManually(
    tenantId: string,
    invoiceId: string,
    accountId: string,
    actor: { sub?: string } | null,
  ): Promise<{ invoiceId: string; linkedAccountId: string }> {
    const invoice = await this.prisma.purchaseInvoice.findFirst({
      where: { id: invoiceId, tenantId },
      select: { id: true, recipientCnpj: true },
    });
    if (!invoice) throw new NotFoundException('Documento não encontrado');

    const account = await this.prisma.marketplaceAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { id: true, cnpj: true },
    });
    if (!account) throw new NotFoundException('Conta não encontrada'); // escopo tenant (RLS também bloqueia)

    const docCnpj = normalizeCnpj(invoice.recipientCnpj);
    if (docCnpj && isValidCnpj(docCnpj)) {
      const accCnpj = normalizeCnpj(account.cnpj);
      if (!accCnpj || accCnpj !== docCnpj) {
        throw new BadRequestException('Conta incompatível: o CNPJ do destinatário difere do CNPJ da conta.');
      }
    }

    await this.prisma.purchaseInvoice.updateMany({ where: { id: invoiceId, tenantId }, data: { marketplaceAccountId: accountId } });
    this.logger.log(
      JSON.stringify({ event: 'purchase_invoice.account_linked_manually', tenantId, invoiceId, accountId, actor: actor?.sub ?? null }),
    );
    return { invoiceId, linkedAccountId: accountId };
  }
}
