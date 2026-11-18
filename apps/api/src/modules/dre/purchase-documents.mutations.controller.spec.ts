import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PurchaseDocumentsController } from './purchase-documents.controller';

// Forma real do principal injetado por @CurrentUser (AuthPrincipal): o id do utilizador é `sub`, não `id`.
const admin = { sub: 'u1', email: 'a@x', tenantId: 'tenant-a', role: 'ADMIN', sid: 's1' };
const operator = { sub: 'u2', email: 'o@x', tenantId: 'tenant-a', role: 'OPERATOR', sid: 's2' };

function make() {
  const invoices = { associateAccountManually: jest.fn(async () => ({ invoiceId: 'inv-1', linkedAccountId: 'acc-1' })) };
  const publication = {
    applyBonus: jest.fn(async (_t: string, _i: string, _d: import('../costs/bonus-allocation').BonusDecision) => ({ invoiceId: 'inv-1', items: [] })),
    publishCosts: jest.fn(async (_t: string, _i: string, _a: { sub?: string } | null) => ({ invoiceId: 'inv-1', ruleType: 'PROPORTIONAL_SPREAD', publishedCount: 2, costs: [] })),
  };
  const controller = new PurchaseDocumentsController(invoices as never, publication as never);
  return { controller, invoices, publication };
}

describe('PurchaseDocumentsController — account/bonus/publish (ADMIN)', () => {
  it('POST :id/account rejeita não-ADMIN e delega associateAccountManually para ADMIN', async () => {
    const { controller, invoices } = make();
    await expect(controller.associateAccount(operator as never, 'inv-1', { accountId: 'acc-1' })).rejects.toBeInstanceOf(ForbiddenException);
    const res = await controller.associateAccount(admin as never, 'inv-1', { accountId: 'acc-1' });
    expect(invoices.associateAccountManually).toHaveBeenCalledWith('tenant-a', 'inv-1', 'acc-1', { sub: 'u1' });
    expect(res.data.linkedAccountId).toBe('acc-1');
  });

  it('POST :id/bonus converte bonusAmount para Decimal e chama applyBonus', async () => {
    const { controller, publication } = make();
    await controller.applyBonus(admin as never, 'inv-1', { hasBonus: true, bonusAmount: '40', rule: 'PROPORTIONAL' });
    const [tenantId, invoiceId, decision] = publication.applyBonus.mock.calls[0];
    expect(tenantId).toBe('tenant-a');
    expect(invoiceId).toBe('inv-1');
    expect(decision.bonusAmount).toBeInstanceOf(Prisma.Decimal);
    expect(decision.bonusAmount.toString()).toBe('40');
    expect(decision.rule).toBe('PROPORTIONAL');
  });

  it('POST :id/bonus mapeia manualUnitCost dos items para Decimal', async () => {
    const { controller, publication } = make();
    await controller.applyBonus(admin as never, 'inv-1', {
      hasBonus: true, bonusAmount: '40', rule: 'PROPORTIONAL', items: [{ lineNumber: '1', manualUnitCost: '7.5' }],
    });
    const decision = publication.applyBonus.mock.calls[0][2];
    expect(decision.manual!['1']).toBeInstanceOf(Prisma.Decimal);
    expect(decision.manual!['1']!.toString()).toBe('7.5');
  });

  it('POST :id/bonus rejeita não-ADMIN', async () => {
    const { controller } = make();
    await expect(controller.applyBonus(operator as never, 'inv-1', { hasBonus: false, rule: 'IGNORE' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('POST :id/publish chama publishCosts e devolve o resumo', async () => {
    const { controller, publication } = make();
    const res = await controller.publish(admin as never, 'inv-1', { confirm: true });
    expect(publication.publishCosts).toHaveBeenCalledWith('tenant-a', 'inv-1', { sub: 'u1' });
    expect(res.data.publishedCount).toBe(2);
  });

  it('POST :id/publish rejeita não-ADMIN', async () => {
    const { controller } = make();
    await expect(controller.publish(operator as never, 'inv-1', { confirm: true })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
