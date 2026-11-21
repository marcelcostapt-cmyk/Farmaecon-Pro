import { NotFoundException } from '@nestjs/common';
import { AdsService } from './ads.service';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    marketplaceAccount: { findFirst: jest.fn().mockResolvedValue({ id: ACCOUNT }) },
    adsCost: {
      count: jest.fn().mockResolvedValue(0),
      createMany: jest.fn().mockResolvedValue({ count: 2 }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ...overrides,
  };
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
    const prisma = makePrisma({ adsCost: { count: jest.fn().mockResolvedValue(2), createMany: jest.fn(), findMany: jest.fn() } });
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, CSV, 'h-ja');
    expect(r.alreadyImported).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/já foi importado.*Nenhuma linha será duplicada/);
  });

  it('ficheiro diferente com linhas no mesmo período avisa sobre possível duplicação', async () => {
    const count = jest.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(5);
    const prisma = makePrisma({ adsCost: { count, createMany: jest.fn(), findMany: jest.fn() } });
    const service = new AdsService(prisma as any);
    const r = await service.preview('t1', ACCOUNT, CSV, 'h-novo');
    expect(r.overlappingRows).toBe(5);
    expect(r.warnings.join(' ')).toMatch(/5 linha\(s\) de outro ficheiro neste período/);
  });
});

describe('ADS — importação idempotente', () => {
  it('importa com skipDuplicates por (conta, hash, linha) e reporta linhas ignoradas', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, CSV, 'h1');
    expect(prisma.adsCost.createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true });
    expect(prisma.adsCost.createMany.mock.calls[0][0].data[0]).toMatchObject({ tenantId: 't1', marketplaceAccountId: ACCOUNT, sourceHash: 'h1', sourceLine: 2 });
    expect(r).toEqual({ received: 2, imported: 2, skipped: 0 });
  });

  it('reimportação do mesmo ficheiro: nenhuma linha nova e todas ignoradas', async () => {
    const prisma = makePrisma({ adsCost: { count: jest.fn(), findMany: jest.fn(), createMany: jest.fn().mockResolvedValue({ count: 0 }) } });
    const service = new AdsService(prisma as any);
    const r = await service.importCsv('t1', ACCOUNT, CSV, 'h1');
    expect(r).toEqual({ received: 2, imported: 0, skipped: 2 });
  });

  it('ficheiro com erros não grava nada', async () => {
    const prisma = makePrisma();
    const service = new AdsService(prisma as any);
    await expect(service.importCsv('t1', ACCOUNT, 'data;valor\n2026-02-30;1\n', 'h')).rejects.toThrow(/Ficheiro rejeitado/);
    expect(prisma.adsCost.createMany).not.toHaveBeenCalled();
  });
});
