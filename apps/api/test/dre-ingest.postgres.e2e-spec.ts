import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { PurchaseInvoiceService } from '../src/modules/dre/purchase-invoice.service';
import { parseDocument } from '../src/modules/costs/document-parser';

// Prova do DRE contra um PostgreSQL REAL: ingest persiste purchase_invoice +
// itens em PENDING_REVIEW, é idempotente por (tenant, sha256) — na aplicação e no
// índice UNIQUE do BD —, NUNCA grava product_costs, e o isolamento por tenant é
// imposto por RLS (ligação runtime = farmaecon_runtime, nunca o owner).
//
// Guardas: a ligação runtime tem de ser farmaecon_runtime numa BD cujo nome
// contém "test"; o owner (TEST_OWNER_DATABASE_URL) só provisiona fixtures.

@Global()
@Module({ providers: [PrismaService, PurchaseInvoiceService], exports: [PrismaService, PurchaseInvoiceService] })
class TestDatabase {}

describe('DRE ingest — PostgreSQL real', () => {
  let app: INestApplication;
  let db: PrismaService;
  let owner: PrismaClient;
  let ingest: PurchaseInvoiceService;
  const prefix = `dre-${randomUUID()}`;
  const tenantA = `${prefix}-a`;
  const tenantB = `${prefix}-b`;

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    if (!['localhost', '127.0.0.1', 'db'].includes(url.hostname) || !url.pathname.includes('test')) {
      throw new Error('É obrigatória uma BD de teste local e explicitamente nomeada');
    }
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (
      url.username !== 'farmaecon_runtime' ||
      ownerUrl.hostname !== url.hostname ||
      ownerUrl.port !== url.port ||
      ownerUrl.pathname !== url.pathname
    ) {
      throw new Error('São exigidas ligações runtime (restrita) e owner (fixtures) coincidentes');
    }
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({ imports: [TestDatabase] }).compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(PrismaService);
    ingest = module.get(PurchaseInvoiceService);
    for (const tenantId of [tenantA, tenantB]) {
      await owner.tenant.create({ data: { id: tenantId, name: tenantId } });
    }
  });

  afterAll(async () => {
    await owner?.purchaseInvoiceItem.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: { in: [tenantA, tenantB] } } });
    await owner?.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
    await owner?.$disconnect();
    await app?.close();
  });

  const realXml = async () => {
    const filename = 'nfe-1333570.xml';
    const buffer = readFileSync(join(__dirname, 'fixtures', filename));
    return parseDocument(filename, buffer);
  };

  it('persiste um NF-e real como PENDING_REVIEW, sem conta vinculada e sem custo', async () => {
    const doc = await realXml();
    const result = await inTenant(tenantA, () => ingest.ingest(tenantA, doc, null));
    expect(result.created).toBe(true);
    expect(result.itemCount).toBeGreaterThan(0);

    const row = await inTenant(tenantA, () =>
      db.purchaseInvoice.findFirstOrThrow({ where: { tenantId: tenantA } }),
    );
    expect(row.status).toBe('PENDING_REVIEW');
    expect(row.marketplaceAccountId).toBeNull(); // vínculo conta↔doc é decisão de negócio #1
    expect(row.fileHashSha256).toBe(doc.fileHashSha256);

    const items = await inTenant(tenantA, () =>
      db.purchaseInvoiceItem.count({ where: { tenantId: tenantA, purchaseInvoiceId: row.id } }),
    );
    expect(items).toBe(result.itemCount);

    // Regra de ouro: ingest NUNCA publica custo.
    const custos = await inTenant(tenantA, () => db.productCost.count({ where: { tenantId: tenantA } }));
    expect(custos).toBe(0);
  });

  it('é idempotente na aplicação: reingestar os mesmos bytes não duplica', async () => {
    const doc = await realXml();
    const again = await inTenant(tenantA, () => ingest.ingest(tenantA, doc, null));
    expect(again.created).toBe(false);
    const total = await inTenant(tenantA, () => db.purchaseInvoice.count({ where: { tenantId: tenantA } }));
    expect(total).toBe(1);
  });

  it('é idempotente no BD: o índice UNIQUE (tenant, sha256) recusa duplicado cru', async () => {
    const doc = await realXml();
    await expect(
      inTenant(tenantA, () =>
        db.purchaseInvoice.create({
          data: {
            tenantId: tenantA,
            source: 'XML',
            originalFilename: 'dup.xml',
            fileHashSha256: doc.fileHashSha256, // mesma chave do já inserido
            status: 'PENDING_REVIEW',
          },
        }),
      ),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('isola por tenant via RLS: o tenant B não vê o documento do tenant A', async () => {
    // Contraprova: o owner ignora RLS e confirma que a linha EXISTE fisicamente,
    // logo o vazio visto por B é a RLS a filtrar dados reais, não tabela vazia.
    const fisicas = await owner.purchaseInvoice.count({ where: { tenantId: tenantA } });
    expect(fisicas).toBe(1);

    const vistosPorB = await inTenant(tenantB, () => db.purchaseInvoice.findMany({ where: {} }));
    expect(vistosPorB).toHaveLength(0);
    const vistosPorA = await inTenant(tenantA, () => db.purchaseInvoice.findMany({ where: {} }));
    expect(vistosPorA).toHaveLength(1);
  });
});
