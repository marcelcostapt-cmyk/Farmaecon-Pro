import { proxyToApi } from '../integrations/api-bridge';

// Cadastro de lote (ADMIN, validado pela API). Só reencaminha os campos conhecidos.
const FIELDS = ['productName', 'ean', 'sku', 'lotNumber', 'fabricationDate', 'expiryDate', 'notes'] as const;

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const forwarded: Record<string, unknown> = {};
  for (const field of FIELDS) if (body && field in body) forwarded[field] = body[field];
  return proxyToApi(request, 'POST', '/lots', forwarded);
}
