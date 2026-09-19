import type { Metadata } from 'next';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Suspense } from 'react';
import CallbackHandler from './callback-handler';
import { fetchApi } from '@/lib/api';

export const metadata: Metadata = { title: 'Integrações | Farmaecon PRO' };

const PLATFORMS: Record<string, { label: string; color: string; icon: string }> = {
  MERCADO_LIVRE: { label: 'Mercado Livre', color: 'border-yellow-400/30 bg-yellow-400/5', icon: '🛒' },
  AMAZON:        { label: 'Amazon',         color: 'border-orange-400/30 bg-orange-400/5', icon: '📦' },
  SHOPEE:        { label: 'Shopee',          color: 'border-red-400/30 bg-red-400/5',       icon: '🛍️' },
};

interface Account {
  id: string;
  name: string;
  platform: string;
  status: string;
  orderCount: number;
  source: string;
  lastSyncedAt: string | null;
}

async function getAccounts() {
  const response = await fetchApi<Account[]>('/integrations');
  return response.data;
}

const ML_CONNECT_URL = '/api/integrations/ml/connect';

export default async function IntegrationsPage() {
  const accounts = await getAccounts();

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
        {accounts.map((account) => {
          const platform = PLATFORMS[account.platform] ?? { label: account.platform, color: '', icon: '🔌' };
          const isWarning = account.status !== 'ACTIVE';

          return (
            <Card key={account.id} className={`border ${platform.color}`}>
              <CardContent className="pt-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{platform.icon}</span>
                    <div>
                      <p className="font-semibold text-sm">{account.name}</p><p className="text-xs">Origem: {account.source}</p>
                      <p className="text-xs text-muted-foreground">{platform.label}</p>
                    </div>
                  </div>
                  <Badge variant={isWarning ? 'destructive' : 'default'}>
                    {isWarning ? '⚠ Expira em breve' : '✓ Ativo'}
                  </Badge>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground border-t pt-3">
                  <span>{account.orderCount} pedidos sincronizados</span>
                  <span>
                    {account.lastSyncedAt ? new Date(account.lastSyncedAt).toLocaleString('pt-BR') : 'Ainda não sincronizada'}
                  </span>
                </div>
                <form action={`/api/integrations/${account.id}/sync`} method="post">
                  <button
                    type="submit"
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    Sincronizar pedidos agora
                  </button>
                </form>
              </CardContent>
            </Card>
          );
        })}

        {/* Connect Mercado Livre button */}
        <a href={ML_CONNECT_URL}>
          <Card className="border-dashed border-2 cursor-pointer hover:border-yellow-400/60 hover:bg-yellow-400/5 transition-all h-full">
            <CardContent className="pt-6 flex flex-col items-center justify-center gap-2 text-center min-h-[140px]">
              <span className="text-3xl">🛒</span>
              <p className="text-sm font-semibold">Conectar Mercado Livre</p>
              <p className="text-xs text-muted-foreground">Autorizar via OAuth oficial</p>
              <span className="text-xs bg-yellow-400/10 text-yellow-600 px-2 py-0.5 rounded-full font-medium mt-1">
                Requer configuração administrativa de PKCE
              </span>
            </CardContent>
          </Card>
        </a>
      </div>
    </div>
  );
}
