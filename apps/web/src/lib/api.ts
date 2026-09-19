'use server';

import { redirect } from 'next/navigation';
import { getAccessToken } from './auth';

const API_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

interface ApiResponse<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
  };
}

async function parseApiResponse<T>(response: Response): Promise<ApiResponse<T>> {
  const body = await response.json().catch(() => null);

  if (response.status === 401) {
    redirect('/login');
  }

  if (!response.ok || !body) {
    const message = body?.message ?? `API request failed with status ${response.status}`;
    throw new Error(message);
  }

  return body as ApiResponse<T>;
}

export async function fetchApi<T>(path: string, init?: RequestInit): Promise<ApiResponse<T>> {
  const token = await getAccessToken();
  if (!token) redirect('/login');

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  return parseApiResponse<T>(response);
}
