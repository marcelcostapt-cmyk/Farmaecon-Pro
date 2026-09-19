import { ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Closed allowlist: no commercial mutation is supported by this MVP.
export function assertObservationRequest(url: URL, init: RequestInit = {}) {
  if (url.origin !== 'https://api.mercadolibre.com' || url.username || url.password || url.hash) throw new ForbiddenException('Marketplace destination blocked');
  const method = (init.method ?? 'GET').toUpperCase();
  if (method === 'GET' && (url.pathname === '/orders/search' || /^\/users\/\d+$/.test(url.pathname))) return;
  if (method === 'POST' && url.pathname === '/oauth/token' && init.body instanceof URLSearchParams) {
    const grant = init.body.get('grant_type');
    if (grant === 'authorization_code' || grant === 'refresh_token') return;
  }
  throw new ForbiddenException('Observation mode blocks this marketplace operation');
}
@Injectable()
export class MarketplaceHttp {
  constructor(private readonly config: ConfigService) {
    if (config.get('MARKETPLACE_MODE', 'OBSERVATION') !== 'OBSERVATION') throw new Error('Only OBSERVATION mode is supported');
  }
  async request(url: URL, init: RequestInit = {}) {
    assertObservationRequest(url, init);
    if (this.config.get('MARKETPLACE_SOURCE', 'MOCK') !== 'MERCADO_LIVRE') throw new ServiceUnavailableException('External marketplace access disabled in local simulation');
    return fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
}
