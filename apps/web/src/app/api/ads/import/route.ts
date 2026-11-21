import { proxyFileToApi } from '../../integrations/api-bridge';

// Importação confirmada do CSV de ADS (ADMIN). Idempotente por ficheiro: reimportar não duplica.
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
  return proxyFileToApi(request, `/ads/import?account_id=${encodeURIComponent(accountId)}`, MAX_BYTES);
}
