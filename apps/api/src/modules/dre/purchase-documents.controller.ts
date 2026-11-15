import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { ok } from '../../shared/types/api-response.type';
import { parseDocument, type UnifiedInvoice } from '../costs/document-parser';

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

function toPreview(doc: UnifiedInvoice) {
  const lines = doc.lines.map((l) => ({
    lineNumber: l.lineNumber,
    sourceRef: l.sourceRef,
    supplierProductCode: l.supplierProductCode,
    ean: l.ean,
    marketplaceSku: l.marketplaceSku,
    description: l.description,
    quantity: dec(l.quantity),
    unitCostExtracted: dec(l.unitCostExtracted),
    totalLine: dec(l.totalLine),
    cfop: l.cfop,
    lotNumber: l.lotNumber,
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
    documentTotal: dec(doc.documentTotal),
    paymentAmountInDocument: dec(doc.paymentAmountInDocument),
    warnings: doc.warnings,
    totals: {
      lines: lines.length,
      withEan: lines.filter((l) => l.ean !== null).length,
      withWarnings: lines.filter((l) => l.warnings.length > 0).length,
    },
    lines,
  };
}

@UseGuards(AuthGuard('jwt'))
@Controller('dre/purchase-documents')
export class PurchaseDocumentsController {
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_BYTES } }))
  async preview(@UploadedFile() file?: UploadedDocument) {
    if (!file) throw new BadRequestException('Nenhum ficheiro enviado no campo "file".');
    if (file.size > MAX_BYTES) throw new BadRequestException('Ficheiro excede o limite de 10 MB.');
    if (!ACCEPTED.test(file.originalname))
      throw new BadRequestException('Formato não suportado: envie XML, PDF ou XLSX.');

    let doc: UnifiedInvoice;
    try {
      doc = await parseDocument(file.originalname, file.buffer);
    } catch (error) {
      throw new BadRequestException(`Falha ao ler o documento: ${(error as Error).message}`);
    }
    return ok(toPreview(doc));
  }
}
