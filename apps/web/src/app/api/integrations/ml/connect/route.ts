import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  const baseUrl = new URL(request.url);

  if (!token) {
    return NextResponse.redirect(new URL('/login', baseUrl));
  }

  const response = await fetch(`${API_URL}/integrations/ml/connect`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    redirect: 'manual',
    cache: 'no-store',
  });

  if (!response.ok) return NextResponse.redirect(new URL('/integrations?error=oauth_failed', baseUrl));
  const { data } = await response.json();
  return NextResponse.redirect(data.url);
}
