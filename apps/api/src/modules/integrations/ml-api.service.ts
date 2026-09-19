import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp } from './marketplace-http.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplacePlatform } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MlOAuthService } from './ml-oauth.service';

interface MlOrderSearchResult {
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

  async listSellerOrders(
    accountId: string,
    tenantId: string,
    options: { limit?: number; maxPages?: number } = {},
  ): Promise<MlOrderSearchResult[]> {
    const limit = options.limit ?? 50;
    const maxPages = options.maxPages ?? 4;
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

    const orders: MlOrderSearchResult[] = [];

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const url = new URL('/orders/search', this.getApiBaseUrl());
      url.searchParams.set('seller', account.externalSellerId);
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sort', 'date_desc');

      const payload = await this.requestForAccount<MlOrderSearchResponse>(account.id, tenantId, url);
      const results = payload.results ?? [];
      orders.push(...results);

      if (results.length < limit) {
        break;
      }

      const total = payload.paging?.total ?? 0;
      if (total > 0 && offset + results.length >= total) {
        break;
      }
    }

    this.logger.log(`Fetched ${orders.length} Mercado Livre orders for account ${accountId}`);
    return orders;
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
