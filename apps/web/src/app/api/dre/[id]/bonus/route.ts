import { proxyToApi } from '../../api-bridge';

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return proxyToApi(request, 'POST', `/dre/purchase-documents/${encodeURIComponent(id)}/bonus`, body);
}
