import { proxyToApi } from '../../api-bridge';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return proxyToApi(request, 'POST', `/integrations/${encodeURIComponent(id)}/reconnect`);
}
