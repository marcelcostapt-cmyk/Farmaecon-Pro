import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdsService } from './ads.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function makePrisma(overrides: Record<string, unknown> = {}) {
  const prisma: any = {
    marketplaceAccount: { findFirst: jest.fn().mockResolvedValue({ id: ACCOUNT }) },
    adsCost: {
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    adsImportBatch: { create: jest.fn().mockResolvedValue({}) },
    ...overrides,
  };
  prisma.$transaction = jest.fn(async (fn: (tx: unknown) => unknown) => fn(prisma));
  return prisma;
}

const CSV = 'data;valor;sku;campanha\n2026-11-10;30;A;C1\n2026-11-11;20;;C2\n';

describe('ADS — pré-visualização sem gravação', () => {
  it('conta de outro tenant (ou inexistente) é recusada', async () => {
    const prisma = makePrisma({ marketplaceAccount: { findFirst: jest.fn().mockResolvedValue(null) } });
    const service = new AdsService(prisma as any);
    await expect(service.preview('t-outro', ACCOUNT, CSV, 'h')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.marketplaceAccount.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ACCOUNT, tenantId: 't-outro' } }));
  });

  it('nunca grava na pré-visualização, mesmo com ficheiro válido', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, CSV, 'h1');
    expect(r.valid).toBe(true);
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
    expect(r.summary).toMatchObject({ rows: 2, firstDay: '2026-11-10', lastDay: '2026-11-11' });
    expect(r.summary?.total.toString()).toBe('50');
  });

  it('ficheiro inválido devolve TODOS os erros por linha e não consulta a base de dados para resumo', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, 'data;valor\n2026-02-30;1\n2026-11-10;x\n', 'h2');
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
    expect(r.errors[0]).toMatch(/Linha 2/);
    expect(r.errors[1]).toMatch(/Linha 3/);
    expect(r.summary).toBeNull();
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
  });

  it('ficheiro já importado (mesmo hash) avisa que nenhuma linha será duplicada', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn().mockResolvedValue(2), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue([]) } });
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, CSV, 'h-ja');
    expect(r.alreadyImported).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/já foi importado.*Nenhuma linha será duplicada/);
  });

  it('ficheiro diferente com linhas coincidentes avisa e exige confirmação', async () => {
    const prisma = makePrisma({
      adsCost: {
        count: jest.fn().mockResolvedValue(0),
        createMany: jest.fn(),
        findMany: jest.fn().mockResolvedValue([
          { day: new Date('2026-11-10'), sku: 'A', campaign: 'C1', amount: new Prisma.Decimal('30'), sourceHash: 'outro-ficheiro', sourceLine: 2 },
        ]),
      },
    });
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, 'data;valor;sku;campanha\n2026-11-10;30;A;C1\n2026-11-11;20;;C2\n', 'h-novo');
    expect(r.overlap?.count).toBe(1);
    expect(r.requiresConfirmation).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/1 linha\(s\), no valor de 30\.00, coincidem/);
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
  });
});

describe('ADS — importação idempotente', () => {
  it('importa com skipDuplicates por (conta, hash, linha) e reporta linhas ignoradas', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, CSV, 'h1');
    expect(prisma.adsCost.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(prisma.adsCost.createMany.mock.calls[0][0].data[0]).toMatchObject({ tenantId: 't1', marketplaceAccountId: ACCOUNT, sourceHash: 'h1', sourceLine: 2 });
    expect(r).toEqual({ received: 2, imported: 2, skipped: 0, overlapCount: 0, overlapConfirmed: false });
  });

  it('reimportação do mesmo ficheiro: nenhuma linha nova e todas ignoradas', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn(), findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, CSV, 'h1');
    expect(r).toEqual({ received: 2, imported: 0, skipped: 2, overlapCount: 0, overlapConfirmed: false });
  });

  it('ficheiro com erros não grava nada', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    await expect(service.importCsv('t1', ACCOUNT, 'data;valor\n2026-02-30;1\n', 'h')).rejects.toThrow(/Ficheiro rejeitado/);
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
  });

});

describe('ADS — sobreposição exige confirmação explícita (backend)', () => {
  const EXISTING = [
    { day: new Date('2026-11-10'), sku: 'A', campaign: 'C1', amount: new Prisma.Decimal('30'), sourceHash: 'outro', sourceLine: 2 },
  ];
  const NEW_CSV = 'data;valor;sku;campanha\n2026-11-10;30;A;C1\n2026-11-11;20;;C2\n';

  it('sobreposição sem confirmação: rejeita com 409 OVERLAP_CONFIRMATION_REQUIRED e não grava', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn(), findMany: jest.fn().mockResolvedValue(EXISTING) } });
    const service = new AdsService(prisma as any);
    const err = await service.importCsv('t1', ACCOUNT, NEW_CSV, 'h-novo').catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.getResponse()).toMatchObject({ code: 'OVERLAP_CONFIRMATION_REQUIRED', overlapCount: 1 });
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
    expect(prisma.adsImportBatch.create).not.toHaveBeenCalled();
  });

  it('sobreposição com confirmação: importa, grava auditoria com overlapConfirmed=true', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn().mockResolvedValue(0), createMany: jest.fn().mockResolvedValue({ count: 2 }), findMany: jest.fn().mockResolvedValue(EXISTING) } });
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, NEW_CSV, 'h-novo', { confirmOverlap: true, fileName: 'x.csv', requestedBy: 'admin-1' });
    expect(r).toMatchObject({ imported: 2, overlapCount: 1, overlapConfirmed: true });
    expect(prisma.adsImportBatch.create.mock.calls[0][0].data).toMatchObject({ overlapCount: 1, overlapConfirmed: true, fileName: 'x.csv', requestedBy: 'admin-1', rowsImported: 2 });
  });

  it('ficheiro sem sobreposição: importa sem confirmação e regista overlapConfirmed=false', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, NEW_CSV, 'h-novo');
    expect(r.overlapConfirmed).toBe(false);
    expect(prisma.adsImportBatch.create.mock.calls[0][0].data.overlapConfirmed).toBe(false);
  });

  it('reimportação do mesmo ficheiro não exige confirmação (mesmo hash não é sobreposição)', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }), findMany: jest.fn().mockResolvedValue([]) } });
    const service = new AdsService(prisma as any);
    await expect(service.importCsv('t1', ACCOUNT, NEW_CSV, 'h-novo')).resolves.toMatchObject({ imported: 0, skipped: 2 });
  });
});
