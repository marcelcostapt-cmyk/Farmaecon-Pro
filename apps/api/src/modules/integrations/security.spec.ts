import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlOAuthService } from './ml-oauth.service';
import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp, assertObservationRequest } from './marketplace-http.service';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { ObservationService } from '../observation/observation.service';
const actor={sub:'user-a',tenantId:'a',role:'ADMIN',sid:'session-a',email:'a@test.local'};
describe('OAuth state, PKCE and vault',()=>{
  let db:MemoryPrisma;let service:MlOAuthService;let vault:TokenVault;let config:ConfigService;
  let http:{request:jest.Mock};let queue:{add:jest.Mock};
  beforeEach(()=>{
    db=new MemoryPrisma();config=new ConfigService({MARKETPLACE_SOURCE:'MERCADO_LIVRE',ML_PKCE_ENABLED:'true',ML_APP_ID:'test-only',ML_SECRET_KEY:randomBytes(32).toString('hex'),ML_REDIRECT_URI:'http://localhost:3000/auth/callback',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')});
    vault=new TokenVault(config);http={request:jest.fn().mockResolvedValue({ok:true,json:async()=>({access_token:'access-fixture',refresh_token:'refresh-fixture',user_id:123,expires_in:3600})})};queue={add:jest.fn()};
    service=new MlOAuthService(config,db as any,queue as any,vault,http as any);
  });
  async function begin(){const {url}=await service.buildAuthorizationUrl(actor);return new URL(url);}
  it('uses random opaque state and S256, and encrypts credentials with tenant context',async()=>{
    const url=await begin();const state=url.searchParams.get('state')!;
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(db.rows.oAuthState[0].stateHash).not.toBe(state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const result=await service.exchangeCode('code-fixture',state,actor);
    const body=http.request.mock.calls[0][1].body as URLSearchParams;
    expect(createHash('sha256').update(body.get('code_verifier')!).digest('base64url')).toBe(url.searchParams.get('code_challenge'));
    const account=db.rows.marketplaceAccount[0];expect(account.accessToken).not.toContain('access-fixture');
    expect(vault.decrypt(account.accessToken,'a:123')).toBe('access-fixture');
    expect(()=>vault.decrypt(account.accessToken,'b:123')).toThrow();
    expect(result).toEqual({accountId:account.id});
  });
  it.each(['invalid','expired','wrong-user','wrong-tenant','wrong-session'])('rejects %s state before network calls',async(kind)=>{
    const url=await begin();let state=url.searchParams.get('state')!;let principal={...actor};
    if(kind==='invalid')state=randomBytes(32).toString('base64url');
    if(kind==='expired')db.rows.oAuthState[0].expiresAt=new Date(0);
    if(kind==='wrong-user')principal.sub='other';if(kind==='wrong-tenant')principal.tenantId='b';if(kind==='wrong-session')principal.sid='other';
    await expect(service.exchangeCode('code-fixture',state,principal)).rejects.toThrow();expect(http.request).not.toHaveBeenCalled();
  });
  it('consumes state exactly once, including concurrent callbacks',async()=>{
    const url=await begin();const state=url.searchParams.get('state')!;
    const results=await Promise.allSettled([service.exchangeCode('code-fixture',state,actor),service.exchangeCode('code-fixture',state,actor)]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(http.request).toHaveBeenCalledTimes(1);
    await expect(service.exchangeCode('code-fixture',state,actor)).rejects.toThrow();
  });
  it('burns state after a provider error rather than allowing replay',async()=>{
    const url=await begin();http.request.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(service.exchangeCode('code',url.searchParams.get('state')!,actor)).rejects.toThrow();
    await expect(service.exchangeCode('code',url.searchParams.get('state')!,actor)).rejects.toThrow();expect(http.request).toHaveBeenCalledTimes(1);
  });
  it('refreshes encrypted credentials only for the owning tenant',async()=>{
    const url=await begin();const {accountId}=await service.exchangeCode('code',url.searchParams.get('state')!,actor);
    http.request.mockClear();await expect(service.refreshToken(accountId,'b')).rejects.toThrow();expect(http.request).not.toHaveBeenCalled();
    await service.refreshToken(accountId,'a');expect(http.request.mock.calls[0][1].body.get('grant_type')).toBe('refresh_token');
    expect(db.rows.marketplaceAccount[0].refreshToken).toMatch(/^v1\./);
  });
  it('rejects plaintext, tampering and missing encryption keys',()=>{
    expect(()=>vault.decrypt('legacy-plaintext','a')).toThrow();
    const encrypted=vault.encrypt('fixture','a');const parts=encrypted.split('.');parts[2]=randomBytes(16).toString('base64url');
    expect(()=>vault.decrypt(parts.join('.'),'a')).toThrow();expect(()=>new TokenVault(new ConfigService({}))).toThrow();
  });
});
describe('Central observation policy',()=>{
  it.each(['POST','PUT','PATCH','DELETE'])('blocks commercial %s calls',method=>{
    for(const path of ['/items','/orders/123','/messages','/shipments/1']) expect(()=>assertObservationRequest(new URL(`https://api.mercadolibre.com${path}`),{method})).toThrow();
  });
  it('allows only known read routes and OAuth grants; rejects redirects/destinations',()=>{
    expect(()=>assertObservationRequest(new URL('https://api.mercadolibre.com/orders/search'))).not.toThrow();
    expect(()=>assertObservationRequest(new URL('https://api.mercadolibre.com/users/123'))).not.toThrow();
    for(const grant of ['authorization_code','refresh_token']) expect(()=>assertObservationRequest(new URL('https://api.mercadolibre.com/oauth/token'),{method:'POST',body:new URLSearchParams({grant_type:grant})})).not.toThrow();
    expect(()=>assertObservationRequest(new URL('https://api.mercadolibre.com/oauth/token'),{method:'POST',body:new URLSearchParams({grant_type:'other'})})).toThrow();
    expect(()=>assertObservationRequest(new URL('https://evil.test/orders/search'))).toThrow();
    expect(()=>assertObservationRequest(new URL('https://api.mercadolibre.com/items/123'))).toThrow();
  });
  it('never calls fetch in local simulation or for a blocked mutation',async()=>{
    const spy=jest.spyOn(global,'fetch').mockRejectedValue(new Error('unexpected network'));
    try {
      const local=new MarketplaceHttp(new ConfigService({MARKETPLACE_SOURCE:'MOCK'}));
      await expect(local.request(new URL('https://api.mercadolibre.com/orders/search'))).rejects.toThrow();
      const live=new MarketplaceHttp(new ConfigService({MARKETPLACE_SOURCE:'MERCADO_LIVRE'}));
      await expect(live.request(new URL('https://api.mercadolibre.com/items'),{method:'POST'})).rejects.toThrow();
      expect(spy).not.toHaveBeenCalled();
    } finally {spy.mockRestore();}
  });
  it('preserves read-only sync and produces isolated simulated reports',async()=>{
    const db=new MemoryPrisma();for(const t of ['a','b'])db.rows.marketplaceAccount.push({id:`account-${t}`,tenantId:t,platform:'MERCADO_LIVRE',source:'SIMULATED',name:t,status:'ACTIVE',lastSyncedAt:null});
    const remote={listSellerOrders:jest.fn()};const sync=new MlOrdersSyncService(db as any,remote as any);
    await expect(sync.syncRecentOrders('account-b','a')).rejects.toThrow();
    await sync.syncRecentOrders('account-a','a');await sync.syncRecentOrders('account-a','a');await sync.syncRecentOrders('account-b','b');
    expect(remote.listSellerOrders).not.toHaveBeenCalled();expect(db.rows.order).toHaveLength(4);
    const report=await new ObservationService(db as any).report('a',new Date(0),new Date());
    expect(report.orderCount).toBe(2);expect(report.sources.map(a=>a.id)).toEqual(['account-a']);
    expect(Number.isFinite(report.sources[0].lastSyncedAt?.getTime())).toBe(true);expect(report.financial.netProfit).toBeNull();expect(report.gaps.join(' ')).toMatch(/Simulated/);
  });
});
