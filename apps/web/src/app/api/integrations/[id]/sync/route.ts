import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  const baseUrl = new URL(request.url);
  if (request.headers.get('origin') !== (process.env.FRONTEND_URL ?? baseUrl.origin)) return new NextResponse('Forbidden', { status: 403 });
  const segments = baseUrl.pathname.split('/');
  const accountId = segments.at(-2);

  if (!token) {
    return NextResponse.redirect(new URL('/login', baseUrl), { status: 303 });
  }

  if (!accountId) {
    return NextResponse.redirect(
      new URL('/integrations?error=sync_failed', baseUrl),
      { status: 303 },
    );
  }

  const response = await fetch(`${API_URL}/integrations/${accountId}/sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    return NextResponse.redirect(
      new URL('/integrations?error=sync_failed', baseUrl),
      { status: 303 },
    );
  }

  return NextResponse.redirect(
    new URL('/integrations?success=sync_requested', baseUrl),
    { status: 303 },
  );
}
