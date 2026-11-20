import { proxyToApi } from '../../api-bridge';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  return proxyToApi(request, 'POST', `/dre/purchase-documents/${encodeURIComponent(id)}/publish`, { confirm: true });
}
