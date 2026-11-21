import { proxyToApi } from '../../integrations/api-bridge';

// Regras de margem (WeStack): só reencaminha os campos conhecidos. A autorização (ADMIN) é feita pela API.
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const forwarded: Record<string, unknown> = {};
  for (const field of ['sku', 'minMarginPercent', 'minMarginAmount'] as const) {
    if (body && field in body) forwarded[field] = body[field];
  }
  return proxyToApi(request, 'PUT', '/margin/rules', forwarded);
}
