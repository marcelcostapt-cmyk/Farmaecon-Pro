import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp } from './marketplace-http.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplacePlatform } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MlOAuthService } from './ml-oauth.service';

export interface MlOrderSearchResult {
  id: number | string;
  status?: string;
  date_created?: string;
  date_closed?: string;
  total_amount?: number;
  total_amount_with_shipping?: number;
}

interface MlOrderSearchResponse {
  paging?: {
    total?: number;
    offset?: number;
    limit?: number;
  };
  results?: MlOrderSearchResult[];
}

export interface MlOrderPage {
  results: MlOrderSearchResult[];
  offset: number;
  limit: number;
  total: number;
  nextOffset: number;
  complete: boolean;
}

@Injectable()
export class MlApiService {
  private readonly logger = new Logger(MlApiService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly mlOAuth: MlOAuthService,
    private readonly vault: TokenVault,
    private readonly http: MarketplaceHttp,
  ) {}

  async listSellerOrdersPage(
    accountId: string,
    tenantId: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<MlOrderPage> {
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(offset) || offset < 0) {
      throw new Error('Invalid pagination bounds');
    }
    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId, source: 'MERCADO_LIVRE', status: 'ACTIVE' },
      select: {
        id: true,
        platform: true,
        externalSellerId: true,
      },
    });

    if (account.platform !== MarketplacePlatform.MERCADO_LIVRE) {
      throw new Error(`Marketplace account ${accountId} is not a Mercado Livre account`);
    }

    if (!account.externalSellerId) {
      throw new Error(`Marketplace account ${accountId} is missing externalSellerId`);
    }

    const url = new URL('/orders/search', this.getApiBaseUrl());
    url.searchParams.set('seller', account.externalSellerId);
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('sort', 'date_desc');

    const payload = await this.requestForAccount<MlOrderSearchResponse>(account.id, tenantId, url);
    const results = payload.results;
    const total = payload.paging?.total;
    const reportedOffset = payload.paging?.offset;
    if (
      !Array.isArray(results) ||
      !Number.isSafeInteger(total) ||
      (total ?? -1) < 0 ||
      reportedOffset !== offset ||
      results.length > limit ||
      offset > (total ?? 0)
    ) {
      throw new Error('Incomplete or inconsistent order pagination');
    }

    const nextOffset = offset + results.length;
    const complete = nextOffset >= (total ?? 0);
    if (!complete && results.length === 0) {
      throw new Error('Order pagination ended before complete coverage');
    }

    this.logger.log(
      `Fetched page offset=${offset} count=${results.length} total=${total} for account ${accountId}`,
    );
    return { results, offset, limit, total: total ?? 0, nextOffset, complete };
  }

  private getApiBaseUrl() {
    return 'https://api.mercadolibre.com';
  }

  private async requestForAccount<T>(accountId: string, tenantId: string, url: URL, retried = false): Promise<T> {
    const account = await this.prisma.marketplaceAccount.findFirstOrThrow({
      where: { id: accountId, tenantId, source: 'MERCADO_LIVRE', status: 'ACTIVE' },
      select: {
        accessToken: true, externalSellerId: true,
      },
    });

    if (!account.accessToken) {
      throw new Error(`Marketplace account ${accountId} has no access token`);
    }

    const response = await this.http.request(url, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${this.vault.decrypt(account.accessToken, `${tenantId}:${account.externalSellerId}`)}`,
      },
    });

    if ((response.status === 401 || response.status === 403) && !retried) {
      this.logger.warn(`Mercado Livre token expired for account ${accountId}; refreshing and retrying`);
      await this.mlOAuth.refreshToken(accountId, tenantId);
      return this.requestForAccount<T>(accountId, tenantId, url, true);
    }

    if (!response.ok) {
      throw new Error(`Mercado Livre API error ${response.status}`);
    }

    return response.json() as Promise<T>;
  }
}
