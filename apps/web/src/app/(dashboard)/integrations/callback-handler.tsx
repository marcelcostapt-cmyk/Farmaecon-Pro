'use client';

import { useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

// This page receives the redirect after ML OAuth callback is processed by the backend.
// Backend redirects to: /integrations?success=ml_connected&account=xxx
// or: /integrations?error=oauth_failed
export default function IntegrationsCallbackHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();

  useEffect(() => {
    const success = searchParams.get('success');
    const error = searchParams.get('error');

    if (success === 'ml_connected' || success === 'sync_requested') {
      // Clean the URL after showing feedback
      setTimeout(() => {
        router.replace('/integrations');
      }, 2000);
    }

    if (error) {
      setTimeout(() => {
        router.replace('/integrations');
      }, 3000);
    }
  }, [searchParams, router]);

  const success = searchParams.get('success');
  const error = searchParams.get('error');

  if (success === 'ml_connected' || success === 'sync_requested') {
    const title = success === 'ml_connected'
      ? 'Mercado Livre conectado!'
      : 'Sincronização iniciada!';
    const description = success === 'ml_connected'
      ? 'Conta conectada e importação inicial de pedidos em andamento.'
      : 'Os pedidos estão sendo importados em segundo plano.';

    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <span className="text-5xl">✅</span>
        <h2 className="text-xl font-bold">{title}</h2>
        <p className="text-sm text-muted-foreground text-center">{description}</p>
        <p className="text-sm text-muted-foreground">Redirecionando para integrações…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 py-20">
        <span className="text-5xl">❌</span>
        <h2 className="text-xl font-bold">Erro na autorização</h2>
        <p className="text-sm text-muted-foreground">
          {error === 'oauth_denied'
            ? 'Autorização negada pelo usuário.'
            : error === 'sync_failed'
              ? 'Não foi possível iniciar a sincronização dos pedidos.'
              : 'Falha na conexão com o Mercado Livre.'}
        </p>
        <p className="text-xs text-muted-foreground">Redirecionando…</p>
      </div>
    );
  }

  return null;
}
