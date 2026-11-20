import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { allocateLots, type AllocationResult } from '../costs/lot-allocation';
import { validityOf, type ValidityStatus } from '../costs/lot-validity';
import type { CreateLotDto, UpdateLotDto } from './lots.dto';

export interface LotFilter {
  product?: string;
  status?: ValidityStatus;
}

interface LotRecord {
  id: string;
  productName: string;
  ean: string | null;
  sku: string | null;
  lotNumber: string;
  quantity: Prisma.Decimal | null;
  fabricationDate: Date | null;
  expiryDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const toIsoDay = (d: Date | null): string | null => (d === null ? null : d.toISOString().slice(0, 10));
const toDay = (s: string | null | undefined): Date | null => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const toQty = (s: string | null | undefined): Prisma.Decimal | null => (s ? new Prisma.Decimal(s) : null);
const clean = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === '' ? null : t;
};

function toView(r: LotRecord) {
  return {
    id: r.id,
    productName: r.productName,
    ean: r.ean,
    sku: r.sku,
    lotNumber: r.lotNumber,
    quantity: r.quantity === null ? null : r.quantity.toString(),
    fabricationDate: toIsoDay(r.fabricationDate),
    expiryDate: toIsoDay(r.expiryDate),
    notes: r.notes,
    updatedAt: r.updatedAt.toISOString(),
  };
}

/** Lotes e validades (cadastro manual). Estado de validade é calculado na leitura; nunca guardado. */
@Injectable()
export class LotsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(tenantId: string, now: Date, filter: LotFilter) {
    const rows = await this.prisma.productLot.findMany({
      where: { tenantId },
      orderBy: [{ expiryDate: 'asc' }, { productName: 'asc' }],
    });
    const needle = filter.product?.trim().toLowerCase();
    return rows
      .filter((r) => !needle || [r.productName, r.ean, r.sku].some((v) => v?.toLowerCase().includes(needle)))
      .map((r) => ({ ...toView(r), ...validityOf(r.expiryDate, now) }))
      .filter((v) => !filter.status || v.status === filter.status);
  }

  /**
   * Sugestão de alocação FEFO/FIFO para uma quantidade de um produto (EAN, SKU ou nome exato).
   * Só leitura: não baixa estoque. Lotes vencidos e sem quantidade ficam de fora, com aviso.
   */
  async allocate(tenantId: string, now: Date, product: string, requested: Prisma.Decimal): Promise<AllocationResult & { product: string }> {
    const key = product.trim().toLowerCase();
    const rows = await this.prisma.productLot.findMany({
      where: { tenantId },
      select: { id: true, lotNumber: true, expiryDate: true, createdAt: true, quantity: true, productName: true, ean: true, sku: true },
    });
    const matching = rows.filter(
      (r) => r.productName.trim().toLowerCase() === key || r.ean?.toLowerCase() === key || r.sku?.toLowerCase() === key,
    );
    return { product, ...allocateLots(matching, requested, now) };
  }

  async create(tenantId: string, actorSub: string | null, dto: CreateLotDto) {
    const productName = dto.productName.trim();
    const lotNumber = dto.lotNumber.trim();
    const fabricationDate = toDay(dto.fabricationDate);
    const expiryDate = toDay(dto.expiryDate);
    if (fabricationDate && expiryDate && expiryDate < fabricationDate)
      throw new BadRequestException('A validade não pode ser anterior à fabricação.');
    const duplicate = await this.prisma.productLot.findFirst({ where: { tenantId, productName, lotNumber }, select: { id: true } });
    if (duplicate) throw new ConflictException('Já existe este lote para este produto.');

    const created = await this.prisma.productLot.create({
      data: {
        tenantId,
        productName,
        ean: clean(dto.ean),
        sku: clean(dto.sku),
        lotNumber,
        quantity: toQty(dto.quantity),
        fabricationDate,
        expiryDate,
        notes: clean(dto.notes),
        createdBy: actorSub,
      },
    });
    return toView(created);
  }

  async update(tenantId: string, id: string, dto: UpdateLotDto) {
    const current = await this.prisma.productLot.findFirst({ where: { id, tenantId } });
    if (!current) throw new NotFoundException('Lote não encontrado.');

    const fabricationDate = dto.fabricationDate === undefined ? current.fabricationDate : toDay(dto.fabricationDate);
    const expiryDate = dto.expiryDate === undefined ? current.expiryDate : toDay(dto.expiryDate);
    if (fabricationDate && expiryDate && expiryDate < fabricationDate)
      throw new BadRequestException('A validade não pode ser anterior à fabricação.');

    const productName = dto.productName === undefined ? current.productName : dto.productName.trim();
    const lotNumber = dto.lotNumber === undefined ? current.lotNumber : dto.lotNumber.trim();
    if (productName !== current.productName || lotNumber !== current.lotNumber) {
      const duplicate = await this.prisma.productLot.findFirst({
        where: { tenantId, productName, lotNumber, NOT: { id } },
        select: { id: true },
      });
      if (duplicate) throw new ConflictException('Já existe este lote para este produto.');
    }

    const updated = await this.prisma.productLot.update({
      where: { id },
      data: {
        productName,
        lotNumber,
        ean: dto.ean === undefined ? current.ean : clean(dto.ean),
        sku: dto.sku === undefined ? current.sku : clean(dto.sku),
        quantity: dto.quantity === undefined ? current.quantity : toQty(dto.quantity),
        fabricationDate,
        expiryDate,
        notes: dto.notes === undefined ? current.notes : clean(dto.notes),
      },
    });
    return toView(updated);
  }
}
