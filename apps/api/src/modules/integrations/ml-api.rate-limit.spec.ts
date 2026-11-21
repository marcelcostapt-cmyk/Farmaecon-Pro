import { ConfigService } from '@nestjs/config';
import { MlApiService } from './ml-api.service';

// Respostas simuladas do Mercado Livre: 429 com ou sem Retry-After, depois 200.
function response(status: number, retryAfter: string | null = null) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => (name.toLowerCase() === 'retry-after' ? retryAfter : null) },
    json: async () => ({ results: [] }),
  };
}

function setup(responses: Array<ReturnType<typeof response>>) {
  const prisma = {
    marketplaceAccount: {
      findFirstOrThrow: jest.fn().mockResolvedValue({ accessToken: 'encrypted', externalSellerId: 'seller-a' }),
    },
  };
  const http = { request: jest.fn() };
  responses.forEach((r) => http.request.mockResolvedValueOnce(r));
  const vault = { decrypt: jest.fn().mockReturnValue('access-fixture') };
  const oauth = { refreshToken: jest.fn() };
  const service = new MlApiService(new ConfigService(), prisma as any, oauth as any, vault as any, http as any);
  const sleep = jest.fn().mockResolvedValue(undefined);
  (service as any).sleep = sleep;
  const call = () => (service as any).requestForAccount('account-a', 'tenant-a', new URL('https://api.mercadolibre.com/orders/search'));
  return { call, http, sleep };
}

describe('MlApiService — 429 do Mercado Livre', () => {
  it('429 com Retry-After: espera o valor indicado e repete com sucesso', async () => {
    const { call, http, sleep } = setup([response(429, '1'), response(200)]);
    await expect(call()).resolves.toEqual({ results: [] });
    expect(http.request).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it('esgota as tentativas e mantém o erro 429 (classificação RATE_LIMITED)', async () => {
    const { call, http, sleep } = setup([response(429), response(429), response(429), response(429)]);
    await expect(call()).rejects.toThrow('Mercado Livre API error 429');
    expect(http.request).toHaveBeenCalledTimes(4); // 1 inicial + 3 repetições
    expect(sleep).toHaveBeenCalledTimes(3);
  });

  it('sem Retry-After usa backoff exponencial (2 s, 4 s, 8 s)', async () => {
    const { call, sleep } = setup([response(429), response(429), response(429), response(429)]);
    await expect(call()).rejects.toThrow();
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([2000, 4000, 8000]);
  });

  it('Retry-After acima do teto é limitado a 10 s', async () => {
    const { call, sleep } = setup([response(429, '3600'), response(200)]);
    await call();
    expect(sleep).toHaveBeenCalledWith(10000);
  });

  it('rateLimitWaitMs: valores válidos, inválidos e teto', () => {
    const service = new MlApiService(new ConfigService(), {} as any, {} as any, {} as any, {} as any) as any;
    expect(service.rateLimitWaitMs('2', 0)).toBe(2000);
    expect(service.rateLimitWaitMs('Wed, 21 Nov 2026 10:00:00 GMT', 1)).toBe(4000);
    expect(service.rateLimitWaitMs(null, 2)).toBe(8000);
    expect(service.rateLimitWaitMs(null, 5)).toBe(10000);
  });
});
