import { Test } from '@nestjs/testing';
import { Global, Module, INestApplication, BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaService } from '../src/shared/prisma/prisma.service';
import { inTenant } from '../src/shared/prisma/tenant-context';
import { PurchaseInvoiceService } from '../src/modules/dre/purchase-invoice.service';
import { parseDocument } from '../src/modules/costs/document-parser';

// Prova do vínculo documento→conta (Parte B) contra PostgreSQL REAL: auto-vínculo por
// CNPJ válido persiste o FK, divergência fica pendente, dedup por renomeação não duplica,
// e a seleção manual exige compatibilidade fiscal. Runtime = farmaecon_runtime (RLS).

@Global()
@Module({ providers: [PrismaService, PurchaseInvoiceService], exports: [PrismaService, PurchaseInvoiceService] })
class TestDatabase {}

const CNPJ_X = '11222333000181';
const CNPJ_Y = '11444777000161';

describe('Vínculo documento→conta — PostgreSQL real', () => {
  let app: INestApplication;
  let db: PrismaService;
  let owner: PrismaClient;
  let svc: PurchaseInvoiceService;
  const prefix = `link-${randomUUID()}`;
  const tenant = `${prefix}-t`;
  const accX = `${prefix}-accx`;
  const accY = `${prefix}-accy`;

  const baseDoc = async () =>
    parseDocument('NFe.xml', readFileSync(join(__dirname, 'fixtures', 'nfe-belajoyce.xml')));

  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? 'http://missing');
    if (!['localhost', '127.0.0.1', 'db'].includes(url.hostname) || !url.pathname.includes('test')) {
      throw new Error('É obrigatória uma BD de teste local e explicitamente nomeada');
    }
    const ownerUrl = new URL(process.env.TEST_OWNER_DATABASE_URL ?? 'http://missing');
    if (url.username !== 'farmaecon_runtime' || ownerUrl.hostname !== url.hostname || ownerUrl.port !== url.port || ownerUrl.pathname !== url.pathname) {
      throw new Error('São exigidas ligações runtime (restrita) e owner (fixtures) coincidentes');
    }
    owner = new PrismaClient({ adapter: new PrismaPg(ownerUrl.toString()) });
    const module = await Test.createTestingModule({ imports: [TestDatabase] }).compile();
    app = module.createNestApplication();
    await app.init();
    db = module.get(PrismaService);
    svc = module.get(PurchaseInvoiceService);

    await owner.tenant.create({ data: { id: tenant, name: tenant } });
    // accX desconectada (prova elegibilidade #1); accY activa com outro CNPJ.
    await owner.marketplaceAccount.create({ data: { id: accX, tenantId: tenant, platform: 'MERCADO_LIVRE', status: 'DISCONNECTED', externalSellerId: '1', name: 'ML #1', cnpj: CNPJ_X, businessName: 'Loja X' } });
    await owner.marketplaceAccount.create({ data: { id: accY, tenantId: tenant, platform: 'MERCADO_LIVRE', status: 'ACTIVE', externalSellerId: '2', name: 'ML #2', cnpj: CNPJ_Y, businessName: 'Loja Y' } });
  });

  afterAll(async () => {
    await owner?.purchaseInvoiceItem.deleteMany({ where: { tenantId: tenant } });
    await owner?.purchaseInvoice.deleteMany({ where: { tenantId: tenant } });
    await owner?.marketplaceAccount.deleteMany({ where: { tenantId: tenant } });
    await owner?.tenant.deleteMany({ where: { id: tenant } });
    await owner?.$disconnect();
    await app?.close();
  });

  it('auto-vincula por CNPJ válido do destinatário (conta desconectada) e persiste o FK', async () => {
    const doc = { ...(await baseDoc()), recipientCnpj: CNPJ_X, fileHashSha256: `${prefix}-h1` };
    const res = await inTenant(tenant, () => svc.ingest(tenant, doc as never, 'u-1'));
    expect(res.accountMatch).toMatchObject({ reason: 'cnpj', linkedAccountId: accX, requiresReview: false });
    const row = await owner.purchaseInvoice.findUniqueOrThrow({ where: { id: res.invoiceId }, select: { marketplaceAccountId: true, status: true } });
    expect(row.marketplaceAccountId).toBe(accX);
    expect(row.status).toBe('PENDING_REVIEW'); // vincular ≠ aprovar custo
    expect(await owner.productCost.count({ where: { tenantId: tenant } })).toBe(0);
  });

  it('CNPJ do documento sem conta igual → não vincula, pendente', async () => {
    const doc = { ...(await baseDoc()), recipientCnpj: '53621953000178', fileHashSha256: `${prefix}-h2` }; // CNPJ válido sem conta
    const res = await inTenant(tenant, () => svc.ingest(tenant, doc as never, 'u-1'));
    expect(res.accountMatch?.linkedAccountId).toBeNull();
    const row = await owner.purchaseInvoice.findUniqueOrThrow({ where: { id: res.invoiceId }, select: { marketplaceAccountId: true } });
    expect(row.marketplaceAccountId).toBeNull();
  });

  it('§6.7 — reimportar o mesmo documento (renomeado) não duplica a compra', async () => {
    const d1 = { ...(await baseDoc()), recipientCnpj: CNPJ_X, fileHashSha256: `${prefix}-h3`, originalFilename: 'original.xml' };
    const a = await inTenant(tenant, () => svc.ingest(tenant, d1 as never, 'u-1'));
    const d2 = { ...d1, originalFilename: 'renomeado.xml' }; // mesmo sha256, nome diferente
    const b = await inTenant(tenant, () => svc.ingest(tenant, d2 as never, 'u-1'));
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(b.invoiceId).toBe(a.invoiceId);
  });

  it('seleção manual exige compatibilidade fiscal e escopo do tenant', async () => {
    const doc = { ...(await baseDoc()), recipientCnpj: CNPJ_X, fileHashSha256: `${prefix}-h4` };
    const { invoiceId } = await inTenant(tenant, () => svc.ingest(tenant, doc as never, 'u-1'));
    // accY tem CNPJ diferente do destinatário → recusa (não contorna a verificação fiscal)
    await expect(inTenant(tenant, () => svc.associateAccountManually(tenant, invoiceId, accY, { sub: 'u-1' } as never))).rejects.toBeInstanceOf(BadRequestException);
    // accX é compatível → aceita
    const ok = await inTenant(tenant, () => svc.associateAccountManually(tenant, invoiceId, accX, { sub: 'u-1' } as never));
    expect(ok.linkedAccountId).toBe(accX);
    const row = await owner.purchaseInvoice.findUniqueOrThrow({ where: { id: invoiceId }, select: { marketplaceAccountId: true } });
    expect(row.marketplaceAccountId).toBe(accX);
  });
});
