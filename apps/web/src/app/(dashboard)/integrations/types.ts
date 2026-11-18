export type AccountStatus = 'ACTIVE' | 'WARNING' | 'DISCONNECTED';

export interface Account {
  id: string;
  name: string;
  displayName: string | null;
  externalSellerId: string | null;
  businessName: string | null;
  cnpj: string | null;
  platform: string;
  status: AccountStatus | string;
  orderCount: number;
  source: string;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  syncStatus: string;
  expectedTotal: number | null;
  importedCount: number;
  lastSyncAttemptAt: string | null;
  syncError: string | null;
}

export interface OAuthConfig {
  oauthAvailable: boolean;
  reason: 'OK' | 'SIMULATED_SOURCE' | 'PKCE_DISABLED' | 'MISSING_CONFIG';
}
