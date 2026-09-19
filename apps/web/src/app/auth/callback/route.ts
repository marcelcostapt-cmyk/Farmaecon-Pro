import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
export async function GET(request: Request) {
  const url = new URL(request.url);
  const access = (await cookies()).get('access_token')?.value;
  if (!access) return NextResponse.redirect(new URL('/login', url));
  const code = url.searchParams.get('code'); const state = url.searchParams.get('state');
  let success = false;
  if (code && state && !url.searchParams.has('error')) {
    try {
      const api = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';
      const response = await fetch(`${api}/integrations/ml/callback`, { method: 'POST', headers: {
        Authorization: `Bearer ${access}`, 'Content-Type': 'application/json',
      }, body: JSON.stringify({ code, state }), cache: 'no-store' });
      success = response.ok;
    } catch { /* No provider error or credentials are exposed */ }
  }
  const response = NextResponse.redirect(new URL(`/integrations?${success ? 'success=ml_connected' : 'error=oauth_failed'}`, url));
  response.headers.set('Referrer-Policy', 'no-referrer');
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
