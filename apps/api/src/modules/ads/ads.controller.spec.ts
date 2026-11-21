import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AdsController } from './ads.controller';

const ACCOUNT = '11111111-1111-4111-8111-111111111111';
const csv = (text: string, name = 'ads.csv') => ({ buffer: Buffer.from(text, 'utf8'), size: Buffer.byteLength(text), originalname: name });

function setup() {
  const service = {
    preview: jest.fn().mockResolvedValue({ valid: true, errors: [], summary: null, warnings: [], sourceHash: 'h', alreadyImported: false, overlappingRows: 0 }),
    importCsv: jest.fn().mockResolvedValue({ received: 1, imported: 1, skipped: 0 }),
    profile: jest.fn().mockResolvedValue({ rows: 0, total: new Prisma.Decimal(0), bySku: [], byCampaign: [] }),
  };
  return { controller: new AdsController(service as any), service };
}

const admin = { sub: 'u1', tenantId: 't1', role: 'ADMIN', email: 'a@x', sid: 's' } as any;
const operator = { ...admin, role: 'OPERATOR' };

describe('ADS — permissões e validação de entrada', () => {
  it('ADMIN pode pré-visualizar e importar', async () => {
    const { controller, service } = setup();
    await controller.previewCsv(admin, 't1', ACCOUNT, csv('data;valor\n2026-11-10;1\n'));
    await controller.importCsv(admin, 't1', ACCOUNT, undefined, csv('data;valor\n2026-11-10;1\n'));
    expect(service.preview).toHaveBeenCalledWith('t1', ACCOUNT, expect.any(String), expect.stringMatching(/^[0-9a-f]{64}$/));
    expect(service.importCsv).toHaveBeenCalledTimes(1);
  });

  it('OPERATOR não pode pré-visualizar nem importar custos de ADS', async () => {
    const { controller, service } = setup();
    await expect(controller.previewCsv(operator, 't1', ACCOUNT, csv('data;valor\n2026-11-10;1\n'))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.importCsv(operator, 't1', ACCOUNT, undefined, csv('data;valor\n2026-11-10;1\n'))).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.importCsv).not.toHaveBeenCalled();
  });

  it('OPERATOR pode consultar os indicadores da conta', async () => {
    const { controller, service } = setup();
    await controller.overview('t1', ACCOUNT);
    expect(service.profile).toHaveBeenCalledWith('t1', ACCOUNT);
  });

  it.each([
    ['identificador de conta ausente', undefined],
    ['identificador de conta com formato inválido', 'not-a-uuid'],
    ['identificador com injeção', "1' OR '1'='1"],
  ])('rejeita %s', async (_label, accountId) => {
    const { controller, service } = setup();
    await expect(controller.importCsv(admin, 't1', accountId as any, undefined, csv('data;valor\n2026-11-10;1\n'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.previewCsv(admin, 't1', accountId as any, csv('data;valor\n2026-11-10;1\n'))).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.overview('t1', accountId as any)).rejects.toBeInstanceOf(BadRequestException);
    expect(service.importCsv).not.toHaveBeenCalled();
  });

  it('ficheiro ausente ou vazio é recusado', async () => {
    const { controller } = setup();
    await expect(controller.importCsv(admin, 't1', ACCOUNT, undefined, undefined)).rejects.toThrow('Envie um ficheiro CSV.');
    await expect(controller.importCsv(admin, 't1', ACCOUNT, undefined, { buffer: Buffer.alloc(0), size: 0, originalname: 'a.csv' })).rejects.toThrow('Envie um ficheiro CSV.');
  });

  it('extensão diferente de .csv é recusada', async () => {
    const { controller } = setup();
    await expect(controller.previewCsv(admin, 't1', ACCOUNT, csv('data;valor\n', 'planilha.xlsx'))).rejects.toThrow('extensão .csv');
    await expect(controller.previewCsv(admin, 't1', ACCOUNT, csv('data;valor\n2026-11-10;1\n', 'RELATORIO.CSV'))).resolves.toBeDefined();
  });

  it('confirmação de sobreposição só conta com o valor exato "true" e leva o nome do ficheiro e o autor', async () => {
    const { controller, service } = setup();
    await controller.importCsv(admin, 't1', ACCOUNT, 'true', csv('data;valor\n2026-11-10;1\n', 'r.csv'));
    expect(service.importCsv.mock.calls[0][4]).toMatchObject({ confirmOverlap: true, fileName: 'r.csv', requestedBy: 'u1' });
    await controller.importCsv(admin, 't1', ACCOUNT, 'yes', csv('data;valor\n2026-11-10;1\n'));
    expect(service.importCsv.mock.calls[1][4]).toMatchObject({ confirmOverlap: false });
    await controller.importCsv(admin, 't1', ACCOUNT, undefined, csv('data;valor\n2026-11-10;1\n'));
    expect(service.importCsv.mock.calls[2][4]).toMatchObject({ confirmOverlap: false });
  });
});
