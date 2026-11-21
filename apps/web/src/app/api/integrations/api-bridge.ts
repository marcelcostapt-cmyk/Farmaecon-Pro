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

/** Same-origin JSON bridge to the API; the httpOnly access token never reaches browser JavaScript. */
export async function proxyToApi(
  request: Request,
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  apiPath: string,
  body?: unknown,
): Promise<NextResponse<ProxyResult>> {
  const expectedOrigin = process.env.FRONTEND_URL ?? new URL(request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin) return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 });

  const token = (await cookies()).get('access_token')?.value;
  if (!token) return NextResponse.json({ ok: false, message: 'Sessão expirada' }, { status: 401 });

  let response: Response;
  try {
    response = await fetch(`${API_URL}${apiPath}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Serviço indisponível. Tente novamente.' }, { status: 502 });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (payload as { code?: unknown } | null)?.code;
    return NextResponse.json({ ok: false, ...(typeof code === 'string' ? { code } : {}), message: messageOf(payload, response.status) }, { status: response.status });
  }
  return NextResponse.json({ ok: true, data: (payload as { data?: unknown } | null)?.data ?? null });
}

/**
 * Reencaminha um ficheiro (multipart) para a API, com a mesma verificação de origem e sessão de
 * proxyToApi. O conteúdo não é registado nem enviado a nenhum outro serviço.
 */
export async function proxyFileToApi(request: Request, apiPath: string, maxBytes: number): Promise<NextResponse<ProxyResult>> {
  const expectedOrigin = process.env.FRONTEND_URL ?? new URL(request.url).origin;
  if (request.headers.get('origin') !== expectedOrigin) return NextResponse.json({ ok: false, message: 'Forbidden' }, { status: 403 });

  const token = (await cookies()).get('access_token')?.value;
  if (!token) return NextResponse.json({ ok: false, message: 'Sessão expirada' }, { status: 401 });

  let incoming: FormData;
  try {
    incoming = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: 'Envio inválido.' }, { status: 400 });
  }
  const file = incoming.get('file');
  if (!(file instanceof File)) return NextResponse.json({ ok: false, message: 'Envie um ficheiro CSV.' }, { status: 400 });
  if (file.size > maxBytes) return NextResponse.json({ ok: false, message: 'O ficheiro excede o limite de 2 MB.' }, { status: 413 });

  const outgoing = new FormData();
  outgoing.append('file', file, file.name);

  let response: Response;
  try {
    response = await fetch(`${API_URL}${apiPath}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      body: outgoing,
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    return NextResponse.json({ ok: false, message: 'Serviço indisponível. Tente novamente.' }, { status: 502 });
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (payload as { code?: unknown } | null)?.code;
    return NextResponse.json({ ok: false, ...(typeof code === 'string' ? { code } : {}), message: messageOf(payload, response.status) }, { status: response.status });
  }
  return NextResponse.json({ ok: true, data: (payload as { data?: unknown } | null)?.data ?? null });
}
