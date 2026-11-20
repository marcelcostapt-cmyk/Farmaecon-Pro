import { proxyToApi } from '../api-bridge';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  // PATCH parcial: só reencaminha as chaves realmente enviadas (preserva omitidos;
  // mantém a distinção entre ausente e null para o backend aplicar a regra correta).
  const forwarded: Record<string, unknown> = {};
  for (const field of ['displayName', 'businessName', 'cnpj'] as const) {
    if (body && field in body) forwarded[field] = body[field];
  }
  return proxyToApi(request, 'PATCH', `/integrations/${encodeURIComponent(id)}`, forwarded);
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return proxyToApi(request, 'DELETE', `/integrations/${encodeURIComponent(id)}`);
}
