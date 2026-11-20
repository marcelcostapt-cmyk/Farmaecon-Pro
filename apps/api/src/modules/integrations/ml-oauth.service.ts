import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { accountConflict } from './account-errors';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { QUEUE_TOKEN_REFRESH } from '../../shared/queue/queue.module';
import { createHash, randomBytes } from 'node:crypto';
import type { AuthPrincipal } from '../auth/auth.service';
import { hashToken } from '../auth/auth.service';
import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp } from './marketplace-http.service';
export type OAuthUnavailableReason = 'SIMULATED_SOURCE' | 'PKCE_DISABLED' | 'MISSING_CONFIG';
export interface OAuthConfig { oauthAvailable: boolean; reason: 'OK' | OAuthUnavailableReason; }
const UNAVAILABLE_MESSAGES: Record<OAuthUnavailableReason, string> = {
  SIMULATED_SOURCE: 'OAuth is disabled for simulated accounts',
  PKCE_DISABLED: 'Enable PKCE in the Mercado Livre application before connecting',
  MISSING_CONFIG: 'Mercado Livre OAuth is not configured',
};
interface Tokens { access_token: string; refresh_token: string; expires_in: number; user_id: number; }
@Injectable()
export class MlOAuthService {
  private readonly logger = new Logger(MlOAuthService.name);
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_TOKEN_REFRESH) private readonly queue: Queue,
    private readonly vault: TokenVault, private readonly http: MarketplaceHttp) {}
  /** Whether the connect/reconnect flow can start; never exposes configuration values. */
  oauthConfig(): OAuthConfig {
    if (this.config.get('MARKETPLACE_SOURCE', 'MOCK') !== 'MERCADO_LIVRE') return { oauthAvailable: false, reason: 'SIMULATED_SOURCE' };
    if (this.config.get('ML_PKCE_ENABLED') !== 'true') return { oauthAvailable: false, reason: 'PKCE_DISABLED' };
    if (!this.config.get('ML_APP_ID') || !this.config.get('ML_REDIRECT_URI')) return { oauthAvailable: false, reason: 'MISSING_CONFIG' };
    return { oauthAvailable: true, reason: 'OK' };
  }
  /** With `expectedAccountId` the callback may only reconnect that account, with the same seller. */
  async buildAuthorizationUrl(actor: AuthPrincipal, expectedAccountId?: string) {
    const availability = this.oauthConfig();
    if (availability.reason !== 'OK') throw new BadRequestException(UNAVAILABLE_MESSAGES[availability.reason]);
    const appId = this.config.getOrThrow<string>('ML_APP_ID');
    const redirectUri = this.config.getOrThrow<string>('ML_REDIRECT_URI');
    const state = randomBytes(32).toString('base64url');
    const verifier = randomBytes(32).toString('base64url');
    const stateHash = hashToken(state);
    await this.prisma.oAuthState.create({ data: {
      stateHash, userId: actor.sub, tenantId: actor.tenantId, sessionId: actor.sid,
      verifier: this.vault.encrypt(verifier, stateHash), expiresAt: new Date(Date.now() + 600000),
      expectedAccountId: expectedAccountId ?? null,
    } });
    const url = new URL('https://auth.mercadolivre.com.br/authorization');
    for (const [key, value] of Object.entries({ response_type: 'code', client_id: appId, redirect_uri: redirectUri,
      state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' })) url.searchParams.set(key, value);
    return { url: url.toString() };
  }
  async exchangeCode(code: string, state: string, actor: AuthPrincipal) {
    if (!code || !/^[A-Za-z0-9_-]{43}$/.test(state ?? '')) throw new BadRequestException('Invalid OAuth callback');
    const stateHash = hashToken(state);
    const stored = await this.prisma.oAuthState.findUnique({ where: { stateHash } });
    if (!stored || stored.userId !== actor.sub || stored.tenantId !== actor.tenantId || stored.sessionId !== actor.sid || stored.consumedAt || stored.expiresAt <= new Date()) throw new UnauthorizedException('Invalid or expired OAuth state');
    const consumed = await this.prisma.oAuthState.updateMany({ where: {
      stateHash, userId: actor.sub, tenantId: actor.tenantId, sessionId: actor.sid, consumedAt: null, expiresAt: { gt: new Date() },
    }, data: { consumedAt: new Date() } });
    if (consumed.count !== 1) throw new UnauthorizedException('OAuth state already used');
    const tokens = await this.tokenRequest(new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: this.vault.decrypt(stored.verifier, stateHash),
      redirect_uri: this.config.getOrThrow('ML_REDIRECT_URI'),
    }));
    const sellerId = String(tokens.user_id);
    const context = `${actor.tenantId}:${sellerId}`;
    const credentials = { accessToken: this.vault.encrypt(tokens.access_token, context), refreshToken: this.vault.encrypt(tokens.refresh_token, context), expiresAt: new Date(Date.now() + tokens.expires_in * 1000) };
    if (stored.expectedAccountId) {
      const expected = await this.prisma.marketplaceAccount.findFirst({
        where: { id: stored.expectedAccountId, tenantId: actor.tenantId, platform: 'MERCADO_LIVRE' },
        select: { id: true, externalSellerId: true },
      });
      if (!expected) throw new NotFoundException('Account not found');
      if (expected.externalSellerId !== sellerId) throw accountConflict('SELLER_MISMATCH');
      await this.prisma.marketplaceAccount.updateMany({ where: { id: expected.id, tenantId: actor.tenantId }, data: { ...credentials, status: 'ACTIVE' } });
      await this.schedule(expected.id, actor.tenantId, tokens.expires_in);
      return { accountId: expected.id, reconnected: true };
    }
    const account = await this.prisma.marketplaceAccount.upsert({
      where: { tenantId_platform_externalSellerId: { tenantId: actor.tenantId, platform: 'MERCADO_LIVRE', externalSellerId: sellerId } },
      update: { ...credentials, status: 'ACTIVE' },
      create: { ...credentials, tenantId: actor.tenantId, platform: 'MERCADO_LIVRE', externalSellerId: sellerId, name: `ML #${sellerId}`, source: 'MERCADO_LIVRE' },
      select: { id: true },
    });
    await this.schedule(account.id, actor.tenantId, tokens.expires_in);
    return { accountId: account.id, reconnected: false };
  }
  private async tokenRequest(body: URLSearchParams): Promise<Tokens> {
    body.set('client_id', this.config.getOrThrow('ML_APP_ID'));
    body.set('client_secret', this.config.getOrThrow('ML_SECRET_KEY'));
    const response = await this.http.request(new URL('https://api.mercadolibre.com/oauth/token'), {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body,
    });
    if (!response.ok) throw new BadRequestException(`Mercado Livre OAuth failed (${response.status})`);
    const t = await response.json() as Tokens;
    if (typeof t.access_token !== 'string' || !t.access_token || typeof t.refresh_token !== 'string' || !t.refresh_token || !Number.isFinite(t.expires_in) || t.expires_in <= 0 || !Number.isSafeInteger(t.user_id) || t.user_id <= 0) throw new BadRequestException('Invalid OAuth response');
    return t;
  }
  async refreshToken(accountId: string, tenantId: string) {
    if (!accountId || !tenantId) throw new Error('Account and tenant are required');
    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({ where: { id: accountId, tenantId, source: 'MERCADO_LIVRE', status: 'ACTIVE' } });
    if (!account.refreshToken || !account.externalSellerId) throw new BadRequestException('Account requires reconnection');
    const context = `${tenantId}:${account.externalSellerId}`;
    const tokens = await this.tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.vault.decrypt(account.refreshToken, context) }));
    if (String(tokens.user_id) !== account.externalSellerId) throw new BadRequestException('OAuth account mismatch');
    await this.prisma.marketplaceAccount.updateMany({ where: { id: accountId, tenantId, status: 'ACTIVE' }, data: {
      accessToken: this.vault.encrypt(tokens.access_token, context), refreshToken: this.vault.encrypt(tokens.refresh_token, context), expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    } });
    await this.schedule(accountId, tenantId, tokens.expires_in);
  }
  private async schedule(accountId: string, tenantId: string, expiresIn: number) {
    try { await this.queue.add('refresh-ml-token', { accountId, tenantId }, { delay: Math.max(expiresIn - 1800, 30) * 1000, attempts: 3, backoff: { type: 'exponential', delay: 2000 } }); }
    catch { this.logger.warn('Token refresh scheduling unavailable'); }
  }
}
