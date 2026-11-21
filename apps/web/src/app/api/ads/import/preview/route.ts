import { proxyFileToApi } from '../../../integrations/api-bridge';

// Pré-visualização do CSV de ADS (ADMIN). Nada é gravado; a API valida tudo e devolve o resumo.
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const accountId = new URL(request.url).searchParams.get('account_id') ?? '';
  return proxyFileToApi(request, `/ads/import/preview?account_id=${encodeURIComponent(accountId)}`, MAX_BYTES);
}
