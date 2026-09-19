import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
export async function proxy(request: NextRequest) {
  const access = request.cookies.get('access_token')?.value;
  let expired = true;
  try { expired = !access || JSON.parse(Buffer.from(access.split('.')[1], 'base64url').toString()).exp <= Date.now() / 1000 + 30; } catch { /* API validates authenticity */ }
  const refreshToken = request.cookies.get('refresh_token')?.value;
  if (expired && refreshToken) {
    try {
      const result = await fetch(`${API_URL}/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store' });
      if (result.ok) {
        const { data } = await result.json();
        request.cookies.set('access_token', data.accessToken);
        request.cookies.set('refresh_token', data.refreshToken);
        const response = NextResponse.next({ request: { headers: request.headers } });
        const options = { httpOnly: true, secure: process.env.NODE_ENV === 'production' && process.env.LOCAL_SIMULATION !== 'true', sameSite: 'lax' as const, path: '/' };
        response.cookies.set('access_token', data.accessToken, { ...options, maxAge: 900 });
        response.cookies.set('refresh_token', data.refreshToken, { ...options, maxAge: 604800 });
        return response;
      }
    } catch { /* Fail closed */ }
    const response = NextResponse.redirect(new URL('/login', request.url));
    response.cookies.delete('access_token'); response.cookies.delete('refresh_token');
    return response;
  }
  if (!access || expired) return NextResponse.redirect(new URL('/login', request.url));
  return NextResponse.next();
}
export const config = { matcher: ['/dashboard/:path*', '/orders/:path*', '/finance/:path*', '/integrations/:path*', '/observation/:path*', '/auth/callback', '/api/integrations/:path*'] };
