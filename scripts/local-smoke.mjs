import assert from 'node:assert/strict';
const base = 'http://127.0.0.1:3001/api/v1';
if (process.env.LOCAL_SIMULATION !== 'true' || process.env.MARKETPLACE_SOURCE !== 'MOCK') throw new Error('Local simulation configuration required');
async function call(path, { token, method = 'GET', body, status = 200 } = {}) {
  const response = await fetch(base + path, { method, headers: { ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(body ? {'Content-Type':'application/json'} : {}) }, ...(body ? {body:JSON.stringify(body)} : {}) });
  assert(response.status === status, `${method} ${path}: unexpected HTTP status ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function login(key) {
  const email = key === 'operator' ? 'operator-a@observation.local' : `admin-${key}@observation.local`;
  const password = process.env[key === 'operator' ? 'DEMO_OPERATOR_A_PASSWORD' : `DEMO_ADMIN_${key.toUpperCase()}_PASSWORD`];
  assert(password, 'Missing local-only password');
  return (await call('/auth/login', {method:'POST',body:{email,password}})).data;
}
const safe = object => assert(!/accessToken|refreshToken|access_token|refresh_token|password|verifier|refreshHash/.test(JSON.stringify(object)), 'Sensitive field leaked');
await call('/health');await call('/ready');await call('/orders',{status:401});
const a=await login('a'), b=await login('b'), operator=await login('operator');
for (const [key,session] of [['a',a],['b',b]]) {
  const accounts=await call('/integrations',{token:session.accessToken});safe(accounts);
  assert(accounts.data.length===1 && accounts.data[0].id===`simulated-${key}`,'Account isolation failed');
  await call(`/integrations/simulated-${key}/sync`,{method:'POST',token:session.accessToken,status:201});
}
let ordersA,ordersB;
for(let i=0;i<40;i++) {
  ordersA=await call('/orders',{token:a.accessToken});ordersB=await call('/orders',{token:b.accessToken});
  if(ordersA.data.length===2 && ordersB.data.length===2)break;
  await new Promise(r=>setTimeout(r,250));
}
assert(ordersA.data.length===2 && ordersB.data.length===2,'Simulated sync did not complete');safe(ordersA);safe(ordersB);
assert(ordersA.data.every(o=>!ordersB.data.some(other=>other.id===o.id)),'Order isolation failed');
await call(`/orders/${ordersB.data[0].id}`,{token:a.accessToken,status:404});
safe(await call(`/orders/${ordersA.data[0].id}`,{token:a.accessToken}));
await call('/users',{method:'POST',token:operator.accessToken,status:403,body:{name:'blocked',email:'blocked@observation.local',password:process.env.DEMO_OPERATOR_A_PASSWORD,role:'ADMIN'}});
await call('/users/admin-b/role',{method:'PATCH',token:a.accessToken,status:404,body:{role:'OPERATOR'}});
await call('/users',{method:'POST',token:a.accessToken,status:400,body:{name:'blocked',email:'blocked@observation.local',password:process.env.DEMO_ADMIN_A_PASSWORD,tenantId:'observation-b'}});
await call('/integrations/ml/callback',{method:'POST',token:a.accessToken,status:401,body:{code:'simulated-invalid-code',state:'x'.repeat(43)}});
for(const [key,session] of [['a',a],['b',b]]) {
 const report=(await call('/observation/report',{token:session.accessToken})).data;safe(report);
 assert(report.orderCount===2 && report.sources.every(s=>s.id===`simulated-${key}`),'Report isolation failed');
 assert(report.financial.netProfit===null && report.financial.complete===false,'Incomplete finance misrepresented');
 assert(report.sources[0].lastSyncedAt && report.sources[0].source==='SIMULATED','Report provenance missing');
}
const renewed=(await call('/auth/refresh',{method:'POST',body:{refreshToken:a.refreshToken}})).data;
await call('/auth/refresh',{method:'POST',body:{refreshToken:a.refreshToken},status:401});
await call('/auth/me',{token:renewed.accessToken,status:401});
await call('/auth/logout',{method:'POST',body:{refreshToken:b.refreshToken}});
await call('/auth/me',{token:b.accessToken,status:401});
console.log('PASS: health/readiness, two companies, isolated simulated sync/report, permissions, no sensitive fields, invalid OAuth, rotation/replay and logout.');
