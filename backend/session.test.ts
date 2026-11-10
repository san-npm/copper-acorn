import test from 'node:test';
import assert from 'node:assert/strict';
import { createSessionHandler } from '../supabase/functions/game-session/handler.ts';

const owner = '10000000-0000-4000-8000-000000000001';
const config = { url: 'https://example.supabase.co', publishableKey: 'public-test-key', secretKey: 'private-test-key', origins: ['http://127.0.0.1:5173'] };
const world = { id: '20000000-0000-4000-8000-000000000001', network: 'testnet', status: 'pending', contract_id: null, created_at: '2026-11-05T00:00:00Z',is_active:true,previous_world_id:null };
const user = { id: owner, is_anonymous: false, email_confirmed_at: '2026-11-05T00:00:00Z' };
const wallet = { account_id: 'ca-20000000000040008000000000000001.testnet', public_key: 'ed25519:' + '1'.repeat(32), funding_requested_at: '2026-11-05T00:00:00Z', faucet_http_status: 200, funded_at: '2026-11-05T00:00:00Z' };

function token(claims = {}) { return ['header',Buffer.from(JSON.stringify({sub:owner,session_id:'30000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600,...claims})).toString('base64url'),'signature'].join('.'); }
function fixture(authUser = user, status = 200, revoked = false) {
  const calls: { url: URL; method: string; headers: Headers; body: unknown }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const body = request.method === 'POST' ? await request.json() : null;
    calls.push({ url, method: request.method, headers: request.headers, body });
    if (url.pathname === '/auth/v1/user') return Response.json(status === 200 ? authUser : { message: 'Invalid JWT', code: 'bad_jwt' }, { status });
    if (url.pathname === '/rest/v1/rpc/game_session_active') return Response.json(!revoked);
    if (url.pathname === '/rest/v1/rpc/ensure_active_game_world') { assert.deepEqual(body,{p_owner:owner});return Response.json(world.id); }
    if (url.pathname === '/rest/v1/game_player_wallets') {
      assert.equal(url.searchParams.get('world_id'), `eq.${world.id}`);
      return Response.json([wallet]);
    }
    assert.equal(url.pathname, '/rest/v1/game_worlds');
    assert.equal(request.method,'GET');
    assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
    if (url.searchParams.has('id')) return Response.json(url.searchParams.get('id')===`eq.${world.id}` ? [world] : []);
    assert.equal(url.searchParams.get('is_active'),'eq.true');
    return Response.json([world]);
  };
  return { calls, handler: createSessionHandler(config, fetcher) };
}

function request(method = 'GET', body?: unknown, extra: Record<string, string> = {}) {
  return new Request('https://example.supabase.co/functions/v1/game-session?user_id=someone-else', {
    method, headers: { Authorization: 'Bearer '+token(), Origin: config.origins[0], 'Content-Type': 'application/json', ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('unverified sessions and foreign origins cannot reach account storage', async () => {
  const { handler, calls } = fixture();
  assert.equal((await handler(new Request('https://example.supabase.co'))).status, 401);
  assert.equal((await handler(request('GET', undefined, { Origin: 'https://attacker.example' }))).status, 403);
  assert.equal((await handler(request('DELETE'))).status, 405);
  assert.equal(calls.length, 0);
  const rejected = fixture(user, 401);
  assert.equal((await rejected.handler(request())).status, 401);
  assert.equal(rejected.calls.length, 1);
});

test('verified identity selects only its own binding, with separate user and admin credentials', async () => {
  const { handler, calls } = fixture();
  const response = await handler(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { world, wallet });
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), config.origins[0]);
  assert.match(calls[0].headers.get('Authorization')!, /^Bearer header\./);
  assert.equal(calls[0].headers.get('apikey'), config.publishableKey);
  assert.equal(calls[1].headers.get('Authorization'), `Bearer ${config.secretKey}`);
  assert.equal(calls.find(c=>c.url.pathname.endsWith('/game_worlds'))!.url.searchParams.get('select'), 'id,network,status,contract_id,created_at,is_active,previous_world_id');
});

test('repeated setup preserves the existing world instead of replacing it', async () => {
  const { handler, calls } = fixture();
  for (let i = 0; i < 2; i++) assert.deepEqual(await (await handler(request('POST', {}))).json(), { world, wallet });
  const writes = calls.filter(c => c.url.pathname.endsWith('/ensure_active_game_world'));
  assert.equal(writes.length, 2);
  assert.deepEqual(writes[0].body, { p_owner: owner });
  assert.equal(calls.filter(c=>c.url.pathname.endsWith('/game_worlds')&&c.method==='POST').length,0);
});

test('client identity, balances, malformed or oversized bodies cannot initialize a world', async () => {
  const { handler, calls } = fixture();
  for (const body of [{ user_id: 'someone-else' }, { copper: 9999 }, [], null]) assert.equal((await handler(request('POST', body))).status, 400);
  assert.equal((await handler(new Request('https://example.supabase.co', { method: 'POST', headers: { Authorization: 'Bearer a-user-session-token', 'Content-Type': 'application/json' }, body: '{' }))).status, 400);
  assert.equal((await handler(request('POST', 'x'.repeat(1100)))).status, 413);
  assert.equal((await handler(request('POST', {}, { 'Content-Type': 'text/plain' }))).status, 415);
  assert.equal(calls.length, 0);
});

test('anonymous and unconfirmed email identities cannot initialize world bindings', async () => {
  for (const candidate of [{ ...user, is_anonymous: true }, { ...user, email_confirmed_at: '' }]) {
    const { handler, calls } = fixture(candidate);
    assert.equal((await handler(request('POST', {}))).status, 403);
    assert.equal(calls.length, 1);
  }
});

test('network failure fails closed without exposing credentials or retrying a write', async () => {
  let attempts = 0;
  const handler = createSessionHandler(config, async () => { attempts++; throw new Error('network interrupted'); });
  const response = await handler(request('POST', {}));
  assert.equal(response.status, 503);
  assert.equal(attempts, 1);
  assert.ok(!(await response.text()).includes(config.secretKey));
});

test('explicit preparation selects only an owned world and never creates or changes the default binding',async()=>{
  const f=fixture(), send=(id:string)=>f.handler(new Request(`https://example.supabase.co/functions/v1/game-session?world_id=${id}`,{method:'POST',headers:{Authorization:'Bearer '+token(),'Content-Type':'application/json'},body:'{}'}));
  assert.equal((await send(world.id)).status,200);
  assert.equal((await send('20000000-0000-4000-8000-000000000002')).status,404);
  assert.equal((await send('invalid')).status,400);
  assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/ensure_active_game_world')).length,0);
  assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/game_player_wallets')).length,1);
});

test('revoked or malformed session claims cannot reach wallet setup',async()=>{
  for (const bearer of [token(),token({exp:1}),token({sub:crypto.randomUUID()}),'bad-token-that-auth-mock-accepts']) {
    const f=fixture(user,200,true);
    assert.equal((await f.handler(request('POST',{}, {Authorization:'Bearer '+bearer}))).status,401);
    assert.equal(f.calls.filter(c=>c.url.pathname.endsWith('/game_worlds')||c.url.pathname.endsWith('/ensure_active_game_world')||c.url.pathname.endsWith('/game_player_wallets')).length,0);
  }
});
