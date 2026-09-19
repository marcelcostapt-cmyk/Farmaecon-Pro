'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

export interface AuthUser {
  id: string;
  email: string;
  tenantId: string;
  role: string;
}

// ── Login Server Action ──────────────────────────────────────────
export async function loginAction(formData: FormData): Promise<{ error?: string }> {
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      cache: 'no-store',
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      return { error: body.message ?? 'Credenciais inválidas' };
    }

    const { data } = await res.json();
    const cookieStore = await cookies();

    // Store tokens in HttpOnly cookies (not accessible by JS)
    cookieStore.set('access_token', data.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && process.env.LOCAL_SIMULATION !== 'true',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
      path: '/',
    });

    cookieStore.set('refresh_token', data.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production' && process.env.LOCAL_SIMULATION !== 'true',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    });
  } catch {
    return { error: 'Erro de conexão com o servidor' };
  }

  redirect('/dashboard');
}

// ── Logout Server Action ─────────────────────────────────────────
export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('refresh_token')?.value;
  if (refreshToken) {
    const response = await fetch(`${API_URL}/auth/logout`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken }), cache: 'no-store' });
    if (!response.ok && response.status !== 401) throw new Error('Não foi possível revogar a sessão. Tente novamente.');
  }
  cookieStore.delete('access_token');
  cookieStore.delete('refresh_token');
  redirect('/login');
}

// ── Get current user (server-side) ──────────────────────────────
export async function getCurrentUser(): Promise<AuthUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get('access_token')?.value;
  if (!token) return null;

  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data as AuthUser;
  } catch {
    return null;
  }
}

// ── Get access token for API calls ──────────────────────────────
export async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get('access_token')?.value ?? null;
}
