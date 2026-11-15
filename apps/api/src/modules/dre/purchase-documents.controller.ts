import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { ok } from '../../shared/types/api-response.type';
import { CurrentUser } from '../../shared/decorators/tenant.decorator';
import { parseDocument, type UnifiedInvoice } from '../costs/document-parser';
import type { BonusCalculation } from '../costs/bonus-calc';
import { PurchaseInvoiceService } from './purchase-invoice.service';

interface RequestUser {
  id: string;
  tenantId: string;
  role: string;
}

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ACCEPTED = /\.(xml|pdf|xlsx|xls)$/i;

/** Subconjunto do ficheiro do multer que usamos; evita depender de @types/multer. */
export interface UploadedDocument {
  originalname: string;
  buffer: Buffer;
  size: number;
  mimetype?: string;
}

const dec = (value: Prisma.Decimal | null): string | null => (value === null ? null : value.toString());

function toBonusCalc(c: BonusCalculation) {
  return {
    ean: c.ean,
    supplierCode: c.supplierCode,
    sourceRefs: c.sourceRefs,
    paidQuantity: c.paidQuantity.toString(),
    bonusQuantity: c.bonusQuantity.toString(),
    totalUnits: c.totalUnits.toString(),
    totalPaid: c.totalPaid.toString(),
    totalBonus: c.totalBonus.toString(),
    approvedOtherExpenses: c.approvedOtherExpenses.toString(),
    status: c.status,
    candidates: c.candidates.map((k) => ({
      rule: k.rule,
      description: k.description,
      formula: k.formula,
      unitCost: dec(k.unitCost),
    })),
  };
}

function toPreview(doc: UnifiedInvoice) {
  const lines = doc.lines.map((l) => ({
    lineNumber: l.lineNumber,
    sourceRef: l.sourceRef,
    supplierProductCode: l.supplierProductCode,
    ean: l.ean,
    marketplaceSku: l.marketplaceSku,
    description: l.description,
    ncm: l.ncm,
    unit: l.unit,
    quantity: dec(l.quantity),
    unitCostExtracted: dec(l.unitCostExtracted),
    unitCostPaid: dec(l.unitCostPaid),
    totalLine: dec(l.totalLine),
    discount: dec(l.discount),
    otherExpense: dec(l.otherExpense),
    cfop: l.cfop,
    lotNumber: l.lotNumber,
    isBonus: l.isBonus,
    approvedAcquisitionCost: null as null,
    warnings: l.warnings,
  }));
  return {
    source: doc.source,
    originalFilename: doc.originalFilename,
    fileHashSha256: doc.fileHashSha256,
    invoiceNumber: doc.invoiceNumber,
    invoiceSeries: doc.invoiceSeries,
    invoiceKey: doc.invoiceKey,
    issuerCnpj: doc.issuerCnpj,
    recipientCnpj: doc.recipientCnpj,
    issuedAt: doc.issuedAt ? doc.issuedAt.toISOString() : null,
    productsTotal: dec(doc.productsTotal),
    otherExpenses: dec(doc.otherExpenses),
    discounts: dec(doc.discounts),
    documentTotal: dec(doc.documentTotal),
    fiscalTotal: dec(doc.fiscalTotal),
    paymentAmountInDocument: dec(doc.paymentAmountInDocument),
    paidAmount: dec(doc.paidAmount),
    bonusAmount: dec(doc.bonusAmount),
    hasBonus: doc.hasBonus,
    bonusCalculations: doc.bonusCalculations.map(toBonusCalc),
    warnings: doc.warnings,
    extractionWarnings: doc.warnings,
    totals: {
      lines: lines.length,
      withEan: lines.filter((l) => l.ean !== null).length,
      withWarnings: lines.filter((l) => l.warnings.length > 0).length,
      bonusLines: lines.filter((l) => l.isBonus).length,
    },
    lines,
  };
}

async function parseUpload(file?: UploadedDocument): Promise<UnifiedInvoice> {
  if (!file) throw new BadRequestException('Nenhum ficheiro enviado no campo "file".');
  if (file.size > MAX_BYTES) throw new BadRequestException('Ficheiro excede o limite de 10 MB.');
  if (!ACCEPTED.test(file.originalname))
    throw new BadRequestException('Formato não suportado: envie XML, PDF ou XLSX.');
  try {
    return await parseDocument(file.originalname, file.buffer);
  } catch (error) {
    throw new BadRequestException(`Falha ao ler o documento: ${(error as Error).message}`);
  }
}

@UseGuards(AuthGuard('jwt'))
@Controller('dre/purchase-documents')
export class PurchaseDocumentsController {
  constructor(private readonly purchaseInvoices: PurchaseInvoiceService) {}

  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async preview(@UploadedFile() file?: UploadedDocument) {
    return ok(toPreview(await parseUpload(file)));
  }

  // Persiste o documento em pending_review (ADMIN). NÃO publica custo nem calcula CMV final.
  @Post()
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async ingest(@CurrentUser() user: RequestUser, @UploadedFile() file?: UploadedDocument) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode importar documentos de custo.');
    const doc = await parseUpload(file);
    const res = await this.purchaseInvoices.ingest(user.tenantId, doc, user.id ?? null);
    return ok(res);
  }
}
