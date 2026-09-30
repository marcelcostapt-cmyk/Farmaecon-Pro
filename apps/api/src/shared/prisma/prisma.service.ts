import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { createPrismaAdapter } from './prisma-options';
import { tenantContext } from './tenant-context';

const models = new Set([
  'tenant',
  'user',
  'authSession',
  'oAuthState',
  'marketplaceAccount',
  'order',
  'product',
  'financialTransaction',
]);
interface LoginRecord {
  id: string;
  email: string;
  password: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);
  private readonly transact: PrismaClient['$transaction'];

  constructor() {
    super({
      adapter: createPrismaAdapter(),
    });
    this.transact = this.$transaction.bind(this);
    // Queries run with SET LOCAL on the same connection; pooled sessions never retain a tenant.
    return new Proxy(this, {
      get: (target, key) => {
        if (typeof key === 'string' && models.has(key)) {
          const model = Reflect.get(target, key) as object;
          return new Proxy(model, {
            get: (delegate, operation) => {
              const value: unknown = Reflect.get(delegate, operation);
              if (typeof value !== 'function') return value;
              return (args: unknown) => {
                const scope = tenantContext.getStore();
                if (!scope)
                  throw new Error('Tenant context required for domain query');
                return target.withTenant(scope.tenantId, (tx) => {
                  const scopedModel = Reflect.get(tx, key) as object;
                  const query = Reflect.get(scopedModel, operation) as (
                    this: object,
                    args: unknown,
                  ) => Promise<unknown>;
                  return query.call(scopedModel, args);
                });
              };
            },
          });
        }
        if (key === '$transaction')
          return (
            operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
          ) => {
            const scope = tenantContext.getStore();
            if (!scope || typeof operation !== 'function')
              throw new Error(
                'Tenant context and interactive transaction required',
              );
            return target.withTenant(scope.tenantId, operation);
          };
        const value: unknown = Reflect.get(target, key, target);
        return typeof value === 'function'
          ? (value as (...args: unknown[]) => unknown).bind(target)
          : value;
      },
    });
  }

  async withTenant<T>(
    tenantId: string,
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    if (!tenantId || typeof tenantId !== 'string')
      throw new Error('Tenant context required');
    const current = tenantContext.getStore();
    if (current && current.tenantId !== tenantId)
      throw new Error('Cross-tenant transaction refused');
    if (current?.transaction) return operation(current.transaction);
    return this.transact(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`;
        return tenantContext.run({ tenantId, transaction: tx }, () =>
          operation(tx),
        );
      },
      { maxWait: 10000, timeout: 15000 },
    );
  }

  async findUserForLogin(email: string): Promise<LoginRecord | null> {
    // Narrow SECURITY DEFINER function is the documented pre-authentication exception.
    const rows = await this.$queryRaw<
      LoginRecord[]
    >`SELECT * FROM public.farmaecon_login_lookup(${email})`;
    return rows[0] ?? null;
  }

  async onModuleInit() {
    await this.$connect();
    const roles = await this.$queryRaw<{ allowed: boolean }[]>`
      SELECT (r.rolname = 'farmaecon_runtime' AND NOT r.rolsuper AND NOT r.rolbypassrls
        AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relkind='r' AND c.relowner=r.oid)) AS allowed
      FROM pg_roles r WHERE r.rolname=current_user`;
    if (!roles[0]?.allowed)
      throw new Error(
        'API requires the non-owner, non-BYPASSRLS runtime database role',
      );
    const policies = await this.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND c.relname IN ('tenants','users','marketplace_accounts','orders',
        'products','financial_transactions','auth_sessions','oauth_states') AND c.relrowsecurity`;
    if (policies[0]?.count !== 8)
      throw new Error('Required tenant RLS policies are missing');
    this.logger.log('✅ Prisma connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    this.logger.log('🔌 Prisma disconnected');
  }
}
