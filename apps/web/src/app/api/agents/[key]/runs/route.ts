import { proxyToApi } from '../../../integrations/api-bridge';

// Disparo de execução de agente (só reencaminha a conta escolhida; a API valida tenant e agente).
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return proxyToApi(request, 'POST', `/agents/${encodeURIComponent(key)}/runs`, { accountId: body.accountId });
}
