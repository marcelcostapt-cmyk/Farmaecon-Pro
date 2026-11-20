import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';
import { MemoryPrisma } from '../../../test/memory-prisma';
import { MlOAuthService } from './ml-oauth.service';
import { TokenVault } from '../../shared/security/token-vault.service';
import { MarketplaceHttp, assertObservationRequest } from './marketplace-http.service';
import { MlOrdersSyncService } from './ml-orders-sync.service';
import { ObservationService } from '../observation/observation.service';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { IntegrationsService } from './integrations.service';
import { AccountErrors } from './account-errors';
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
    expect(result).toEqual({accountId:account.id,reconnected:false});
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
describe('reconnect',()=>{
  let db:MemoryPrisma;let service:MlOAuthService;let vault:TokenVault;let http:{request:jest.Mock};let queue:{add:jest.Mock};let integrations:IntegrationsService;
  const tokens=(userId:number)=>({ok:true,json:async()=>({access_token:'access-new',refresh_token:'refresh-new',user_id:userId,expires_in:3600})});
  const baseConfig={MARKETPLACE_SOURCE:'MERCADO_LIVRE',ML_PKCE_ENABLED:'true',ML_APP_ID:'test-only',ML_SECRET_KEY:'s'.repeat(64),ML_REDIRECT_URI:'http://localhost:3000/auth/callback',TOKEN_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
  const disconnected=(overrides:Record<string,unknown>={})=>({id:'acc-a',tenantId:'a',platform:'MERCADO_LIVRE',status:'DISCONNECTED',externalSellerId:'123',name:'ML #123',displayName:'Farmashop',accessToken:null,refreshToken:null,expiresAt:null,source:'MERCADO_LIVRE',createdAt:new Date(),...overrides});
  beforeEach(()=>{
    db=new MemoryPrisma();const config=new ConfigService(baseConfig);vault=new TokenVault(config);http={request:jest.fn().mockResolvedValue(tokens(123))};queue={add:jest.fn()};
    service=new MlOAuthService(config,db as any,queue as any,vault,http as any);
    integrations=new IntegrationsService(db as any,{} as any,{} as any,{} as any,service,undefined);
    db.rows.marketplaceAccount.push(disconnected());
  });
  const stateOf=(url:string)=>new URL(url).searchParams.get('state')!;
  it('reconnects the same account when the seller matches',async()=>{
    const {url}=await service.buildAuthorizationUrl(actor,'acc-a');
    expect(db.rows.oAuthState[0].expectedAccountId).toBe('acc-a');
    await expect(service.exchangeCode('code',stateOf(url),actor)).resolves.toEqual({accountId:'acc-a',reconnected:true});
    expect(db.rows.marketplaceAccount).toHaveLength(1);
    const account=db.rows.marketplaceAccount[0];
    expect(account).toMatchObject({status:'ACTIVE',displayName:'Farmashop'});
    expect(vault.decrypt(account.accessToken,'a:123')).toBe('access-new');
  });
  it('rejects a different seller without writing anything',async()=>{
    http.request.mockResolvedValue(tokens(999));
    const {url}=await service.buildAuthorizationUrl(actor,'acc-a');
    const error=await service.exchangeCode('code',stateOf(url),actor).catch(e=>e);
    expect(error).toBeInstanceOf(ConflictException);
    expect(error.getResponse()).toEqual({code:'SELLER_MISMATCH',message:AccountErrors.SELLER_MISMATCH});
    expect(db.rows.marketplaceAccount).toHaveLength(1);
    expect(db.rows.marketplaceAccount[0]).toMatchObject({status:'DISCONNECTED',accessToken:null,refreshToken:null});
    expect(queue.add).not.toHaveBeenCalled();
  });
  it('fails when the expected account was deleted before the callback',async()=>{
    const {url}=await service.buildAuthorizationUrl(actor,'acc-a');
    db.rows.marketplaceAccount=[];
    await expect(service.exchangeCode('code',stateOf(url),actor)).rejects.toBeInstanceOf(NotFoundException);
    expect(db.rows.marketplaceAccount).toHaveLength(0);
  });
  it('new connect for an existing disconnected seller reactivates it and keeps displayName',async()=>{
    const {url}=await service.buildAuthorizationUrl(actor);
    expect(db.rows.oAuthState[0].expectedAccountId ?? null).toBeNull();
    await expect(service.exchangeCode('code',stateOf(url),actor)).resolves.toEqual({accountId:'acc-a',reconnected:false});
    expect(db.rows.marketplaceAccount).toHaveLength(1);
    expect(db.rows.marketplaceAccount[0]).toMatchObject({id:'acc-a',status:'ACTIVE',displayName:'Farmashop'});
  });
  it('startReconnect refuses accounts that are not DISCONNECTED',async()=>{
    db.rows.marketplaceAccount[0].status='ACTIVE';
    const error=await integrations.startReconnect(actor,'acc-a').catch(e=>e);
    expect(error).toBeInstanceOf(ConflictException);expect(error.getResponse()).toMatchObject({code:'RECONNECT_NOT_ALLOWED'});
    await expect(integrations.startReconnect({...actor,tenantId:'b'},'acc-a')).rejects.toBeInstanceOf(NotFoundException);
    db.rows.marketplaceAccount[0].status='DISCONNECTED';
    const {url}=await integrations.startReconnect(actor,'acc-a');
    expect(new URL(url).hostname).toBe('auth.mercadolivre.com.br');
    expect(db.rows.oAuthState.at(-1).expectedAccountId).toBe('acc-a');
  });
  it('oauthConfig reports why OAuth is unavailable',()=>{
    const make=(overrides:Record<string,unknown>)=>new MlOAuthService(new ConfigService({...baseConfig,...overrides}),db as any,queue as any,vault,http as any).oauthConfig();
    expect(make({MARKETPLACE_SOURCE:'MOCK'})).toEqual({oauthAvailable:false,reason:'SIMULATED_SOURCE'});
    expect(make({ML_PKCE_ENABLED:'false'})).toEqual({oauthAvailable:false,reason:'PKCE_DISABLED'});
    expect(make({ML_APP_ID:undefined})).toEqual({oauthAvailable:false,reason:'MISSING_CONFIG'});
    expect(make({})).toEqual({oauthAvailable:true,reason:'OK'});
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
