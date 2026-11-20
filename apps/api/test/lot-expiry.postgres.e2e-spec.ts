import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { DrePreviewService } from '../src/modules/dre/dre-preview.service';
import { money } from '../src/modules/costs/cost-money';

// Prova em PostgreSQL REAL da leitura de lotes vencidos/a vencer (validade da NF-e).
// Ligação runtime = farmaecon_runtime; o seed usa a ligação owner (bypass de RLS, só dados de teste).

@Global()
@Module({ providers: [PrismaService, DrePreviewService], exports: [PrismaService, DrePreviewService] })
class TestDatabase {}

describe('Validade de lotes — PostgreSQL real', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let dre: DrePreviewService;
  const prefix = `lot-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;
  const accountA = `${prefix}-acc`;
  const now = new Date('2026-11-20T15:00:00Z');

  async function seedItem(tenantId: string, invoiceId: string, lineNumber: string, lotNumber: string, expiry: string | null) {
    await owner.purchaseInvoiceItem.create({
      data: {
        tenantId,
        purchaseInvoiceId: invoiceId,
        lineNumber,
        sourceRef: `det[${lineNumber}]`,
        description: `PRODUTO ${lotNumber}`,
        lotNumber,
        quantity: money('10'),
        expiryDate: expiry === null ? null : new Date(`${expiry}T00:00:00.000Z`),
      },
    });
  }

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
    dre = module.get(DrePreviewService);

    for (const id of [tenantA, tenantB]) await owner.tenant.create({ data: { id, name: id } });
    await owner.marketplaceAccount.create({
      data: { id: accountA, tenantId: tenantA, platform: 'MERCADO_LIVRE', name: 'ML #lote', source: 'SIMULATED', status: 'ACTIVE' },
    });
    const invoice = await owner.purchaseInvoice.create({
      data: {
        tenantId: tenantA, marketplaceAccountId: accountA, source: 'XML', originalFilename: 'nfe-lotes.xml',
        fileHashSha256: `${prefix}-hash`, status: 'APPROVED',
      },
      select: { id: true },
    });
    // 2026-11-10 → vencido (−10 dias) · 2026-12-31 → a vencer (+41) · 2027-06-01 → fora da janela de 90 dias
    // sem validade → nunca aparece · 2026-12-20 → exatamente no limite de 30 dias
    await seedItem(tenantA, invoice.id, '1', 'L-VENCIDO', '2026-11-10');
    await seedItem(tenantA, invoice.id, '2', 'L-41', '2026-12-31');
    await seedItem(tenantA, invoice.id, '3', 'L-LONGE', '2027-06-01');
    await seedItem(tenantA, invoice.id, '4', 'L-SEM-VALIDADE', null);
    await seedItem(tenantA, invoice.id, '5', 'L-LIMITE-30', '2026-12-20');
  });

  afterAll(async () => {
    const tenants = { in: [tenantA, tenantB] };
    await owner?.purchaseInvoiceItem.deleteMany({ where: { tenantId: tenants } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: tenants } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenants } });
    await owner?.tenant.deleteMany({ where: { id: tenants } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('lista vencidos e os que vencem na janela de 90 dias, do mais urgente', async () => {
    const lots = await inTenant(tenantA, () => dre.expiringLots(tenantA, now, 90));
    expect(lots.map((l) => l.lotNumber)).toEqual(['L-VENCIDO', 'L-LIMITE-30', 'L-41']);
    expect(lots[0].status).toBe('vencido');
    expect(lots[0].daysToExpiry).toBe(-10);
    expect(lots[2].status).toBe('a_vencer');
    expect(lots[2].daysToExpiry).toBe(41);
    expect(lots[0].invoiceFilename).toBe('nfe-lotes.xml');
    expect(lots[0].invoiceStatus).toBe('APPROVED');
  });

  it('janela menor exclui lotes além do limite (30 dias inclui 20/12, exclui 31/12)', async () => {
    const lots = await inTenant(tenantA, () => dre.expiringLots(tenantA, now, 30));
    expect(lots.map((l) => l.lotNumber)).toEqual(['L-VENCIDO', 'L-LIMITE-30']);
  });

  it('isola por tenant: tenant B não vê lotes de A', async () => {
    const lots = await inTenant(tenantB, () => dre.expiringLots(tenantB, now, 365));
    expect(lots).toHaveLength(0);
  });
});
