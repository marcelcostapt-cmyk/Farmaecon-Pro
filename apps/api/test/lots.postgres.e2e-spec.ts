import { Test } from '@nestjs/testing';
import { BadRequestException, ConflictException, Global, INestApplication, Module, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { LotsService } from '../src/modules/lots/lots.service';
import type { CreateLotDto, UpdateLotDto } from '../src/modules/lots/lots.dto';

// Gestão de lotes em PostgreSQL REAL (RLS): cadastro, estados de validade, filtros e isolamento.
// Ligação runtime = farmaecon_runtime; seed/cleanup pela ligação owner (só dados de teste).

@Global()
@Module({ providers: [PrismaService, LotsService], exports: [PrismaService, LotsService] })
class TestDatabase {}

describe('Lotes e validades — PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let lots: LotsService;
  const prefix = `lots-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const now = new Date('2026-11-20T15:00:00Z');
  const actor = 'user-admin-test';

  const base = (over: Partial<CreateLotDto> = {}): CreateLotDto => ({
    productName: 'DIPIRONA 500MG',
    ean: '7891234567890',
    sku: null,
    lotNumber: 'LOTE-001',
    fabricationDate: '2026-01-10',
    expiryDate: '2027-01-10',
    notes: null,
    ...over,
  });

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (!url.pathname.includes('test') || url.username !== 'farmaecon_runtime' || ownerUrl.pathname !== url.pathname) {
      throw new Error('Exige BD de teste local com ligações runtime e owner coincidentes');
    }
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({ imports: [TestDatabase] }).compile();
    app = module.createNestApplication();
    await app.init();
    lots = module.get(LotsService);
    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] };
    await owner?.productLot.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('cadastra o lote, normaliza campos vazios para null e devolve o estado de validade', async () => {
    const created = await inTenant(tenantA, () =>
      lots.create(tenantA, actor, base({ productName: '  DIPIRONA 500MG  ', sku: '   ', notes: ' ver NF ' })),
    );
    expect(created.productName).toBe('DIPIRONA 500MG');
    expect(created.sku).toBeNull();
    expect(created.notes).toBe('ver NF');
    expect(created.expiryDate).toBe('2027-01-10');
    expect(created.fabricationDate).toBe('2026-01-10');
  });

  it('lista com estado calculado e filtra por status e por produto (nome, EAN ou SKU)', async () => {
    await inTenant(tenantA, () => lots.create(tenantA, actor, base({ productName: 'AMOXICILINA', ean: null, lotNumber: 'AMX-1', expiryDate: '2026-12-10', fabricationDate: null })));
    await inTenant(tenantA, () => lots.create(tenantA, actor, base({ productName: 'VITAMINA C', ean: null, sku: 'MLB-99', lotNumber: 'VC-1', expiryDate: '2026-10-01', fabricationDate: null })));
    await inTenant(tenantA, () => lots.create(tenantA, actor, base({ productName: 'SEM DATA', ean: null, lotNumber: 'SD-1', expiryDate: null, fabricationDate: null })));

    const all = await inTenant(tenantA, () => lots.list(tenantA, now, {}));
    expect(all[0].productName).toBe('VITAMINA C'); // vencido: primeiro (validade mais antiga)
    expect(all[0].status).toBe('vencido');
    expect(all.find((l) => l.productName === 'AMOXICILINA')!.status).toBe('vence_em_30');
    expect(all.find((l) => l.productName === 'DIPIRONA 500MG')!.status).toBe('vigente');
    expect(all.find((l) => l.productName === 'SEM DATA')!.status).toBe('sem_validade');

    const soon = await inTenant(tenantA, () => lots.list(tenantA, now, { status: 'vence_em_30' }));
    expect(soon.map((l) => l.productName)).toEqual(['AMOXICILINA']);

    const byEan = await inTenant(tenantA, () => lots.list(tenantA, now, { product: '7891234567890' }));
    expect(byEan.map((l) => l.productName)).toEqual(['DIPIRONA 500MG']);

    const bySku = await inTenant(tenantA, () => lots.list(tenantA, now, { product: 'mlb-99' }));
    expect(bySku.map((l) => l.productName)).toEqual(['VITAMINA C']);
  });

  it('rejeita lote duplicado (mesmo produto e número) e validade anterior à fabricação', async () => {
    await expect(inTenant(tenantA, () => lots.create(tenantA, actor, base()))).rejects.toThrow(ConflictException);
    await expect(
      inTenant(tenantA, () => lots.create(tenantA, actor, base({ lotNumber: 'NOVO', fabricationDate: '2027-02-01', expiryDate: '2027-01-10' }))),
    ).rejects.toThrow(BadRequestException);
  });

  it('edita um lote: troca a validade e recalcula o estado; colisão de nome+lote vira conflito', async () => {
    const listed = await inTenant(tenantA, () => lots.list(tenantA, now, { product: 'AMOXICILINA' }));
    const id = listed[0].id;
    const patch: UpdateLotDto = { expiryDate: '2027-06-30' };
    const updated = await inTenant(tenantA, () => lots.update(tenantA, id, patch));
    expect(updated.expiryDate).toBe('2027-06-30');
    const after = await inTenant(tenantA, () => lots.list(tenantA, now, { product: 'AMOXICILINA' }));
    expect(after[0].status).toBe('vigente');

    const collide: UpdateLotDto = { lotNumber: 'LOTE-001', productName: 'DIPIRONA 500MG' };
    await expect(inTenant(tenantA, () => lots.update(tenantA, id, collide))).rejects.toThrow(ConflictException);
  });

  it('alocação FEFO: consome o lote de validade mais próxima; vencidos e sem quantidade ficam de fora', async () => {
    const base2 = { productName: 'ALLOC PROD', ean: '7890000000001', sku: null, fabricationDate: null, notes: null };
    await inTenant(tenantA, () => lots.create(tenantA, actor, { ...base2, lotNumber: 'AL-B', expiryDate: '2027-02-01', quantity: '10' }));
    await inTenant(tenantA, () => lots.create(tenantA, actor, { ...base2, lotNumber: 'AL-A', expiryDate: '2027-01-01', quantity: '4' }));
    await inTenant(tenantA, () => lots.create(tenantA, actor, { ...base2, lotNumber: 'AL-SEMQTD', expiryDate: '2027-01-15' }));
    await inTenant(tenantA, () => lots.create(tenantA, actor, { ...base2, lotNumber: 'AL-VENC', expiryDate: '2026-11-01', quantity: '50' }));

    const r = await inTenant(tenantA, () => lots.allocate(tenantA, now, '7890000000001', new Prisma.Decimal(12)));
    expect(r.allocations.map((a) => [a.lotNumber, a.take.toString(), a.rule])).toEqual([
      ['AL-A', '4', 'FEFO'],
      ['AL-B', '8', 'FEFO'],
    ]);
    expect(r.missing.toString()).toBe('0');
    expect(r.warnings.some((w) => w.includes('AL-VENC'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('AL-SEMQTD'))).toBe(true);
  });

  it('alocação: quantidade acima do estoque reporta a falta; nome do produto sem diferenciar maiúsculas', async () => {
    const r = await inTenant(tenantA, () => lots.allocate(tenantA, now, 'alloc prod', new Prisma.Decimal(30)));
    expect(r.allocated.toString()).toBe('14');
    expect(r.missing.toString()).toBe('16');
  });

  it('isolamento: tenant B não edita nem vê lotes de A', async () => {
    const listed = await inTenant(tenantA, () => lots.list(tenantA, now, { product: 'VITAMINA' }));
    await expect(inTenant(tenantB, () => lots.update(tenantB, listed[0].id, { notes: 'x' }))).rejects.toThrow(NotFoundException);
    const seenByB = await inTenant(tenantB, () => lots.list(tenantB, now, {}));
    expect(seenByB).toHaveLength(0);
  });
});
