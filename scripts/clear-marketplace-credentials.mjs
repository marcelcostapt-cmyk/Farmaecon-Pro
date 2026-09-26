import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

if (!process.argv.includes('--all-mercado-livre') || process.env.FARMAECON_CLEAR_MARKETPLACE_CREDENTIALS !== 'confirmed') {
  throw new Error('Explicit all-Mercado-Livre cleanup confirmation is required');
}
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; never provide it as a command argument');
const db = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL) });
try {
  const result = await db.$transaction(async tx => {
    const accounts = await tx.marketplaceAccount.updateMany({
      where: { platform: 'MERCADO_LIVRE', source: 'MERCADO_LIVRE' },
      data: { accessToken: null, refreshToken: null, expiresAt: null, status: 'DISCONNECTED' },
    });
    const states = await tx.oAuthState.deleteMany({});
    return { accounts: accounts.count, oauthStates: states.count };
  });
  console.log(JSON.stringify({ status: 'cleared', ...result, providerRevocation: 'must be performed by the account owner' }));
} finally { await db.$disconnect(); }
