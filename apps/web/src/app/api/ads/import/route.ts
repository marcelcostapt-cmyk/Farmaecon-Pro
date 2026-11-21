import { proxyFileToApi } from '../../integrations/api-bridge';

// Importação confirmada do CSV de ADS (ADMIN). Idempotente por ficheiro. Com sobreposição com outro
// ficheiro, a API exige confirm_overlap=true (confirmação explícita, validada no servidor).
const MAX_BYTES = 2 * 1024 * 1024;

export async function POST(request: Request) {
  const params = new URL(request.url).searchParams;
  const accountId = params.get('account_id') ?? '';
  const confirm = params.get('confirm_overlap') === 'true' ? '&confirm_overlap=true' : '';
  return proxyFileToApi(request, `/ads/import?account_id=${encodeURIComponent(accountId)}${confirm}`, MAX_BYTES);
}
