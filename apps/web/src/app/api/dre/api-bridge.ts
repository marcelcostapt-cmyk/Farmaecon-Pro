import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export type ProxyResult<T = unknown> = { ok: true; data: T } | { ok: false; code?: string; message: string };

function messageOf(body: unknown, status: number): string {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join(' ');
  if (typeof message === 'string' && message) return message;
  return status >= 500 ? 'Serviço indisponível. Tente novamente.' : 'Não foi possível concluir a ação.';
}

function failure(body: unknown, status: number): NextResponse<ProxyResult> {
  const code = (body as { code?: unknown } | null)?.code;
  return NextResponse.json(
    { ok: false, ...(typeof code === 'string' ? { code } : {}), message: messageOf(body, status) },
    { status },
  );
}

async function guard(request: Request): Promise<{ token: string } | NextResponse<ProxyResult>> {
  const expectedOrigin = process.env.FRONTEND_URL ?? new URL(request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin) return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 });
  const token = (await cookies()).get('access_token')?.value;
  if (!token) return NextResponse.json({ ok: false, message: 'Sessão expirada' }, { status: 401 });
  return { token };
}

/** Same-origin JSON bridge to the API; the httpOnly access token never reaches browser JavaScript. */
export async function proxyToApi(request: Request, method: 'POST' | 'PATCH' | 'DELETE', apiPath: string, body?: unknown): Promise<NextResponse<ProxyResult>> {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;

  let response: Response;
  try {
    response = await fetch(`${API_URL}${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${g.token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Serviço indisponível. Tente novamente.' }, { status: 502 });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) return failure(payload, response.status);
  return NextResponse.json({ ok: true, data: (payload as { data?: unknown } | null)?.data ?? null });
}

/** Same-origin multipart bridge: forwards the uploaded file to a single API multipart endpoint. */
async function postFile(token: string, apiPath: string, file: File): Promise<Response> {
  const form = new FormData();
  form.append('file', file, file.name);
  return fetch(`${API_URL}${apiPath}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    body: form,
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  });
}

/**
 * Faz upload do documento: persiste (ingest → invoiceId + vínculo de conta) e, em paralelo,
 * extrai a prévia (linhas) para a tabela de revisão. As linhas NÃO são gravadas; servem só à UI.
 */
export async function proxyUpload(request: Request): Promise<NextResponse<ProxyResult>> {
  const g = await guard(request);
  if (g instanceof NextResponse) return g;

  let file: File | null = null;
  try {
    const incoming = await request.formData();
    const value = incoming.get('file');
    if (value instanceof File) file = value;
  } catch {
    return NextResponse.json({ ok: false, message: 'Envio inválido.' }, { status: 400 });
  }
  if (!file) return NextResponse.json({ ok: false, message: 'Nenhum ficheiro enviado no campo "file".' }, { status: 400 });

  let ingestRes: Response;
  let previewRes: Response;
  try {
    [ingestRes, previewRes] = await Promise.all([
      postFile(g.token, '/dre/purchase-documents', file),
      postFile(g.token, '/dre/purchase-documents/preview', file),
    ]);
  } catch {
    return NextResponse.json({ ok: false, message: 'Serviço indisponível. Tente novamente.' }, { status: 502 });
  }

  const ingestBody = await ingestRes.json().catch(() => null);
  if (!ingestRes.ok) return failure(ingestBody, ingestRes.status);
  const previewBody = await previewRes.json().catch(() => null);
  if (!previewRes.ok) return failure(previewBody, previewRes.status);

  const ingest = (ingestBody as { data?: unknown } | null)?.data ?? null;
  const preview = (previewBody as { data?: { lines?: unknown } } | null)?.data ?? null;
  return NextResponse.json({ ok: true, data: { ingest, lines: preview?.lines ?? [] } });
}
