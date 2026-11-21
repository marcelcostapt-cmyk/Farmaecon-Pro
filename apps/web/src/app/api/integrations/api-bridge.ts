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
