import { BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { IntegrationsService } from './integrations.service';

// Conta com identidade fiscal já preenchida, para provar preservação parcial.
function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'acc-a', tenantId: 'a', platform: 'MERCADO_LIVRE', status: 'ACTIVE', name: 'ML #1',
    displayName: 'Loja A', externalSellerId: '1', accessToken: 'enc-access', refreshToken: 'enc-refresh',
    expiresAt: new Date(), createdAt: new Date(),
    businessName: 'DROGARIA BELAJOYCE LTDA-ME', businessNameNormalized: 'DROGARIA BELAJOYCE',
    cnpj: '11222333000181', ...overrides,
  };
}

function setup(rows: Record<string, unknown>[] = [account()]) {
  const db = new MemoryPrisma();
  db.rows.marketplaceAccount.push(...rows);
  const syncQueue = { add: jest.fn(), getJobs: jest.fn().mockResolvedValue([]) };
  const tokenQueue = { getJobs: jest.fn().mockResolvedValue([]) };
  const ordersSync = { syncRecentOrders: jest.fn() };
  const scheduler = { removeRecurring: jest.fn(), ensureRecurring: jest.fn(), nextRunAt: jest.fn().mockResolvedValue(null) };
  const service = new IntegrationsService(db as never, syncQueue as never, tokenQueue as never, ordersSync as never, {} as never, scheduler as never);
  return { db, service };
}
const actor = { sub: 'u-1', tenantId: 'a', role: 'ADMIN', sid: 's' } as never;
const row = (db: MemoryPrisma) => db.rows.marketplaceAccount[0] as Record<string, unknown>;

describe('IntegrationsService.updateIdentity — PATCH parcial', () => {
  it('altera só displayName e preserva razão social e CNPJ (§6.1)', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { displayName: 'Novo Nome' });
    expect(row(db)).toMatchObject({
      displayName: 'Novo Nome',
      businessName: 'DROGARIA BELAJOYCE LTDA-ME',
      businessNameNormalized: 'DROGARIA BELAJOYCE',
      cnpj: '11222333000181',
    });
  });

  it('atualiza razão social (e normalizada) sem apagar o CNPJ (§6.2)', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { businessName: 'Maxifarmá Distribuidora EIRELI' });
    expect(row(db)).toMatchObject({
      businessName: 'Maxifarmá Distribuidora EIRELI',
      businessNameNormalized: 'MAXIFARMA DISTRIBUIDORA',
      cnpj: '11222333000181', // preservado
    });
  });

  it('limpa um campo opcional com null explícito, preservando os demais', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { cnpj: null });
    expect(row(db).cnpj).toBeNull();
    expect(row(db).businessName).toBe('DROGARIA BELAJOYCE LTDA-ME'); // não tocado
  });

  it('rejeita CNPJ inválido sem modificar o registo (§6.2/§6.3) — nunca vira null+sucesso', async () => {
    const { db, service } = setup();
    await expect(
      service.updateIdentity('a', 'acc-a', actor, { cnpj: '11222333000182' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(row(db).cnpj).toBe('11222333000181'); // intacto
  });

  it('aceita CNPJ numérico e alfanumérico válidos, guardando normalizado (§6.3)', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { cnpj: '12.ABC.345/01DE-35' });
    expect(row(db).cnpj).toBe('12ABC34501DE35');
  });

  it('texto vazio em razão social → regra explícita (null), normalizada null', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { businessName: '   ' });
    expect(row(db).businessName).toBeNull();
    expect(row(db).businessNameNormalized).toBeNull();
  });

  it('campo omitido é preservado (não envia = não altera)', async () => {
    const { db, service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, {}); // nada enviado
    expect(row(db)).toMatchObject({ cnpj: '11222333000181', businessName: 'DROGARIA BELAJOYCE LTDA-ME', displayName: 'Loja A' });
  });

  it('bloqueia conta de outro tenant (NotFound) sem modificar (§6.4)', async () => {
    const { db, service } = setup();
    await expect(service.updateIdentity('b', 'acc-a', actor, { displayName: 'X' })).rejects.toBeInstanceOf(NotFoundException);
    expect(row(db).displayName).toBe('Loja A');
  });

  it('não retorna tokens', async () => {
    const { service } = setup();
    const result = await service.updateIdentity('a', 'acc-a', actor, { displayName: 'Y' });
    expect(JSON.stringify(result)).not.toMatch(/enc-access|enc-refresh/);
  });

  it('regista auditoria com autor e campos alterados, sem o valor do CNPJ', async () => {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { service } = setup();
    await service.updateIdentity('a', 'acc-a', actor, { cnpj: '11.222.333/0001-81', businessName: 'Nova Razão' });
    const logged = spy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(logged).toMatch(/u-1/); // autor
    expect(logged).toMatch(/cnpj/); // nome do campo alterado
    expect(logged).toMatch(/businessName/);
    expect(logged).not.toMatch(/11222333000181|11\.222\.333/); // nunca o valor fiscal completo
    spy.mockRestore();
  });
});
