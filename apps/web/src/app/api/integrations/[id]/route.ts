import { proxyToApi } from '../proxy';

type Context = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Context) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const displayName = typeof body?.displayName === 'string' ? body.displayName : null;
  return proxyToApi(request, 'PATCH', `/integrations/${encodeURIComponent(id)}`, { displayName });
}

export async function DELETE(request: Request, { params }: Context) {
  const { id } = await params;
  return proxyToApi(request, 'DELETE', `/integrations/${encodeURIComponent(id)}`);
}
