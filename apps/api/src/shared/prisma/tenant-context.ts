import { AsyncLocalStorage } from 'node:async_hooks';
import type { Prisma } from '@prisma/client';

export const tenantContext = new AsyncLocalStorage<{
  tenantId: string;
  transaction?: Prisma.TransactionClient;
}>();
export function inTenant<T>(tenantId: string, operation: () => T): T {
  if (!tenantId || typeof tenantId !== 'string')
    throw new Error('Authenticated tenant context required');
  const current = tenantContext.getStore();
  if (current && current.tenantId !== tenantId)
    throw new Error('Tenant context cannot change inside an operation');
  return tenantContext.run(current ?? { tenantId }, operation);
}
