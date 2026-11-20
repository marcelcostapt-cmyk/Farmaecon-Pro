import { ForbiddenException } from '@nestjs/common';
import type { AuthPrincipal } from '../auth/auth.service';
import { LotsController } from './lots.controller';
import type { LotsService } from './lots.service';

const service = {
  list: jest.fn(async () => []),
  create: jest.fn(async () => ({ id: 'x' })),
  update: jest.fn(async () => ({ id: 'x' })),
} as unknown as LotsService;

const principal = (role: string): AuthPrincipal => ({ sub: 'u1', email: 'u@t.local', tenantId: 't1', role, sid: 's1' });
const dto = { productName: 'P', lotNumber: 'L' };

describe('LotsController — permissões de escrita', () => {
  const controller = new LotsController(service);

  it('OPERATOR não cadastra nem edita lotes', async () => {
    await expect(controller.create(principal('OPERATOR'), 't1', dto)).rejects.toThrow(ForbiddenException);
    await expect(controller.update(principal('OPERATOR'), 't1', 'id', { notes: 'x' })).rejects.toThrow(ForbiddenException);
    expect(service.create).not.toHaveBeenCalled();
    expect(service.update).not.toHaveBeenCalled();
  });

  it('ADMIN cadastra e edita', async () => {
    await controller.create(principal('ADMIN'), 't1', dto);
    await controller.update(principal('ADMIN'), 't1', 'id', { notes: 'x' });
    expect(service.create).toHaveBeenCalledTimes(1);
    expect(service.update).toHaveBeenCalledTimes(1);
  });

  it('status inválido na listagem é recusado', async () => {
    await expect(controller.list('t1', undefined, 'nope')).rejects.toThrow('status inválido.');
  });
});
