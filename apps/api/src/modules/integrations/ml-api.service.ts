import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp } from './marketplace-http.service';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MarketplacePlatform } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { MlOAuthService } from './ml-oauth.service';
import { RemoteOrder } from './order-validation';

type MlOrderSearchResult = RemoteOrder;

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
    if (!Number.isInteger(limit) || limit < 1 || limit > 50 || !Number.isInteger(maxPages) || maxPages < 1 || maxPages > 100) throw new Error('Invalid pagination bounds');
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
    const seen = new Set<string>();
    let expectedTotal: number | undefined;
    let completed = false;

    for (let page = 0; page < maxPages; page += 1) {
      const offset = page * limit;
      const url = new URL('/orders/search', this.getApiBaseUrl());
      url.searchParams.set('seller', account.externalSellerId);
      url.searchParams.set('offset', String(offset));
      url.searchParams.set('limit', String(limit));
      url.searchParams.set('sort', 'date_desc');

      const payload = await this.requestForAccount<MlOrderSearchResponse>(account.id, tenantId, url);
      const results = payload.results;
      const total = payload.paging?.total;
      if (!Array.isArray(results) || !Number.isSafeInteger(total) || total! < 0 || payload.paging?.offset !== offset
        || results.length > limit || (expectedTotal !== undefined && expectedTotal !== total)) throw new Error('Incomplete or inconsistent order pagination');
      expectedTotal = total;
      for (const order of results) {
        const id = String(order.id);
        if (seen.has(id)) throw new Error('Duplicate order across pages; retry synchronization');
        seen.add(id);
      }
      orders.push(...results);
      if (orders.length === total) {
        completed = true;
        break;
      }
      if (results.length < limit || orders.length > total!) throw new Error('Order pagination ended before complete coverage');
    }

    if (!completed) throw new Error('Order pagination safety limit reached; synchronization incomplete');

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

    if (response.status === 401 && !retried) {
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
