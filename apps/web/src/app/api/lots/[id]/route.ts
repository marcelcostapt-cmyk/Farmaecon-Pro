import { proxyToApi } from '../../integrations/api-bridge';

// Edição de lote (ADMIN, validado pela API). PATCH parcial: só reencaminha as chaves enviadas.
const FIELDS = ['productName', 'ean', 'sku', 'lotNumber', 'fabricationDate', 'expiryDate', 'notes'] as const;

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const forwarded: Record<string, unknown> = {};
  for (const field of FIELDS) if (body && field in body) forwarded[field] = body[field];
  return proxyToApi(request, 'PATCH', `/lots/${encodeURIComponent(id)}`, forwarded);
}
