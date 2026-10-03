import { NextRequest } from 'next/server';
import { proxy } from '../src/proxy';

const token = (exp: number) => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
const incoming = (cookie = '') => new NextRequest('https://app.farmaecon.com.br/observation', { headers: { cookie } });

describe('Frontend session renewal boundary', () => {
  afterEach(() => jest.restoreAllMocks());
  it('redirects an absent or expired session to login', async () => {
    for (const cookie of ['', `access_token=${token(1)}`]) {
      const response = await proxy(incoming(cookie));
      expect(response.headers.get('location')).toBe('https://app.farmaecon.com.br/login');
    }
  });
  it('passes a current session without renewing it', async () => {
    const fetcher = jest.spyOn(global, 'fetch');
    const response = await proxy(incoming(`access_token=${token(Date.now() / 1000 + 900)}`));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('rotates both HttpOnly cookies and forwards renewed credentials to server rendering', async () => {
    const accessToken = token(Date.now() / 1000 + 900);
    jest.spyOn(global, 'fetch').mockResolvedValue(Response.json({ data: { accessToken, refreshToken: 'rotated-refresh' } }));
    const response = await proxy(incoming(`access_token=${token(1)}; refresh_token=old-refresh`));
    expect(response.cookies.get('access_token')?.value).toBe(accessToken);
    expect(response.cookies.get('refresh_token')?.value).toBe('rotated-refresh');
    expect(response.cookies.get('access_token')?.httpOnly).toBe(true);
    expect(response.cookies.get('refresh_token')?.httpOnly).toBe(true);
    expect(response.headers.get('x-middleware-request-cookie')).toContain(`access_token=${accessToken}`);
    expect(await response.text()).toBe('');
  });
  it.each([401, 500])('clears cookies and refuses failed renewal (%s)', async status => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status }));
    const response = await proxy(incoming('refresh_token=revoked-refresh'));
    expect(response.headers.get('location')).toBe('https://app.farmaecon.com.br/login');
    expect(response.cookies.get('access_token')?.value).toBe('');
    expect(response.cookies.get('refresh_token')?.value).toBe('');
  });
});
