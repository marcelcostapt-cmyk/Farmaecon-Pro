import type { Metadata } from 'next';
import { Suspense } from 'react';
import CallbackHandler from './callback-handler';
import AccountCard from './account-card';
import ConnectCard from './connect-card';
import type { Account, OAuthConfig } from './types';
import { fetchApi } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';

export const metadata: Metadata = { title: 'Integrações | Farmaecon PRO' };

const OAUTH_UNKNOWN: OAuthConfig = { oauthAvailable: false, reason: 'MISSING_CONFIG' };

export default async function IntegrationsPage() {
  // Independent requests: start together, not one after another.
  const [accounts, oauthConfig, user] = await Promise.all([
    fetchApi<Account[]>('/integrations').then((response) => response.data),
    fetchApi<OAuthConfig>('/integrations/ml/config').then((response) => response.data).catch(() => OAUTH_UNKNOWN),
    getCurrentUser(),
  ]);
  const isAdmin = user?.role === 'ADMIN';

  return (
    <div className="flex flex-col gap-6">
      {/* OAuth callback feedback */}
      <Suspense fallback={null}>
        <CallbackHandler />
      </Suspense>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Integrações</h1>
          <p className="text-sm text-muted-foreground">Modo Observação · contas simuladas são identificadas pela origem</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((account) => (
          <AccountCard key={account.id} account={account} isAdmin={isAdmin} />
        ))}
        {isAdmin ? <ConnectCard config={oauthConfig} /> : null}
      </div>
    </div>
  );
}
