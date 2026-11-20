import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Prisma } from '@prisma/client';
import { IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Equals, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ok } from '../../shared/types/api-response.type';
import { CurrentUser } from '../../shared/decorators/tenant.decorator';
import { parseDocument, type UnifiedInvoice } from '../costs/document-parser';
import type { BonusCalculation } from '../costs/bonus-calc';
import { money } from '../costs/cost-money';
import type { BonusRule, BonusDecision } from '../costs/bonus-allocation';
import type { AuthPrincipal } from '../auth/auth.service';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { CostPublicationService } from './cost-publication.service';

// O principal injetado por @CurrentUser é o AuthPrincipal: o id do utilizador é `sub`.
type RequestUser = AuthPrincipal;

const BONUS_RULES: BonusRule[] = ['PROPORTIONAL', 'SPECIFIC_SKU', 'IGNORE'];

class AssociateAccountDto {
  @IsUUID() accountId: string;
}
class BonusItemDto {
  @IsString() lineNumber: string;
  @IsOptional() @IsString() manualUnitCost?: string;
}
class BonusDecisionDto {
  @IsBoolean() hasBonus: boolean;
  @IsOptional() @IsString() bonusAmount?: string;
  @IsIn(BONUS_RULES) rule: BonusRule;
  @IsOptional() @IsString() specificSkuEan?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => BonusItemDto) items?: BonusItemDto[];
}
class PublishDto {
  @IsBoolean() @Equals(true) confirm: boolean;
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
    fabricationDate: l.fabricationDate,
    expiryDate: l.expiryDate,
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
  constructor(
    private readonly purchaseInvoices: PurchaseInvoiceService,
    private readonly publication: CostPublicationService,
  ) {}

  private ensureAdmin(user: RequestUser) {
    if (user.role !== 'ADMIN') throw new ForbiddenException('Apenas ADMIN pode gerir custos.');
  }

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
    const res = await this.purchaseInvoices.ingest(user.tenantId, doc, user.sub ?? null);
    return ok(res);
  }

  // Vincula manualmente o documento a uma conta ML (compatibilidade fiscal no serviço).
  @Post(':id/account')
  async associateAccount(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: AssociateAccountDto) {
    this.ensureAdmin(user);
    return ok(await this.purchaseInvoices.associateAccountManually(user.tenantId, id, dto.accountId, { sub: user.sub }));
  }

  // Aplica a decisão de bonificação e recalcula o custo por linha. NÃO publica.
  @Post(':id/bonus')
  async applyBonus(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() dto: BonusDecisionDto) {
    this.ensureAdmin(user);
    const manual: Record<string, Prisma.Decimal> = {};
    for (const it of dto.items ?? []) if (it.manualUnitCost != null) manual[it.lineNumber] = money(it.manualUnitCost);
    const decision: BonusDecision = {
      hasBonus: dto.hasBonus,
      bonusAmount: money(dto.bonusAmount ?? '0'),
      rule: dto.rule,
      specificSkuEan: dto.specificSkuEan ?? null,
      manual,
    };
    return ok(await this.publication.applyBonus(user.tenantId, id, decision, { sub: user.sub }));
  }

  // Aprova e publica os custos em product_costs. Confirmação explícita obrigatória.
  @Post(':id/publish')
  async publish(@CurrentUser() user: RequestUser, @Param('id') id: string, @Body() _dto: PublishDto) {
    this.ensureAdmin(user);
    return ok(await this.publication.publishCosts(user.tenantId, id, { sub: user.sub }));
  }
}
