import { Card, CardContent } from '@/components/ui/card';
import type { OAuthConfig } from './types';

const UNAVAILABLE: Record<Exclude<OAuthConfig['reason'], 'OK'>, string> = {
  PKCE_DISABLED: 'PKCE não configurado administrativamente',
  SIMULATED_SOURCE: 'Modo simulado — OAuth desativado',
  MISSING_CONFIG: 'Configuração OAuth incompleta',
};

export default function ConnectCard({ config }: { config: OAuthConfig }) {
  const content = (available: boolean) => (
    <CardContent className="pt-6 flex flex-col items-center justify-center gap-2 text-center min-h-[140px]">
      <span className="text-3xl" aria-hidden>🛒</span>
      <p className="text-sm font-semibold">Conectar Mercado Livre</p>
      <p className="text-xs text-muted-foreground">Autorizar via OAuth oficial</p>
      {available ? (
        <span className="text-xs bg-green-500/10 text-green-700 px-2 py-0.5 rounded-full font-medium mt-1">PKCE configurado</span>
      ) : (
        <span className="text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full font-medium mt-1">
          {config.reason === 'OK' ? '' : UNAVAILABLE[config.reason]}
        </span>
      )}
    </CardContent>
  );

  return config.oauthAvailable ? (
    // Full page navigation: the route handler redirects to the Mercado Livre OAuth page (no <Link> prefetch).
    // eslint-disable-next-line @next/next/no-html-link-for-pages
    <a href="/api/integrations/ml/connect">
      <Card className="border-dashed border-2 cursor-pointer hover:border-yellow-400/60 hover:bg-yellow-400/5 transition-all h-full">
        {content(true)}
      </Card>
    </a>
  ) : (
    <Card aria-disabled className="border-dashed border-2 opacity-60 cursor-not-allowed h-full">
      {content(false)}
    </Card>
  );
}
