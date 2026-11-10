import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { KeyPair } from '@near-js/crypto';
import { playerWallet } from '../supabase/functions/game-session/wallet.ts';

const world = '20000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000001';
const account = 'ca-' + world.replaceAll('-', '') + '.testnet';
type Stored = { account_id: string; public_key: string; funding_requested_at: string | null; funded_at: string | null; faucet_http_status: number | null };

function fixture(options: { faucetStatus?: number; disconnected?: boolean; preexisting?: boolean; mismatch?: boolean; rpcDown?: boolean; capacity?: boolean } = {}) {
  let stored: Stored | null = null, chainExists = !!options.preexisting, faucetCalls = 0, secret = '', extra = '';
  const fetcher: typeof fetch = async (input, init) => {
    const r = new Request(input, init), url = new URL(r.url);
    const body = r.method === 'GET' ? null : await r.json();
    if (url.hostname === 'test.rpc.fastnear.com') {
      assert.equal(r.headers.get('Authorization'), null);
      assert.equal(body.params.account_id, account);assert.equal(body.params.finality, 'final');
      if (options.rpcDown) throw new Error('RPC unavailable');
      if (!chainExists) return Response.json({ error: { cause: { name: 'UNKNOWN_ACCOUNT' } } });
      if (body.params.request_type === 'view_account') return Response.json({ result: { amount: '10000000000000000000000000' } });
      assert.equal(body.params.public_key, stored!.public_key);
      return options.mismatch ? Response.json({ error: { cause: { name: 'UNKNOWN_ACCESS_KEY' } } }) : Response.json({ result: { permission: 'FullAccess' } });
    }
    if (url.hostname === 'helper.nearprotocol.com') {
      faucetCalls++;
      assert.equal(r.headers.get('Authorization'), null);
      assert.deepEqual(Object.keys(body).sort(), ['newAccountId', 'newAccountPublicKey']);
      assert.equal(body.newAccountId, account);assert.equal(body.newAccountPublicKey, stored!.public_key);
      assert.ok(!JSON.stringify(body).includes(secret));
      if (options.disconnected) { chainExists = true; throw new Error('Response lost after creation'); }
      if ((options.faucetStatus || 200) === 200) chainExists = true;
      return Response.json({}, { status: options.faucetStatus || 200 });
    }
    assert.equal(url.hostname, 'example.supabase.co');
    assert.equal(r.headers.get('Authorization'), 'Bearer server-test-key');
    if (url.pathname.endsWith('/rpc/register_game_wallet')) {
      assert.equal(body.p_owner_id, owner);assert.equal(body.p_world_id, world);
      if (options.capacity) return Response.json({ message: 'Development wallet capacity reached', code: 'P0001' }, { status: 400 });
      secret = body.p_secret_key;
      assert.ok(KeyPair.fromString(secret as `ed25519:${string}`).getPublicKey().toString() === body.p_public_key, 'Private/public pair must match');
      stored = { account_id: account, public_key: body.p_public_key, funding_requested_at: null, faucet_http_status: null, funded_at: null };
      return Response.json([{ ...stored, secret_id: 'must-not-be-returned', private_key: secret }]);
    }
    if (url.pathname.endsWith('/rpc/claim_game_wallet_faucet')) {
      assert.equal(body.p_owner_id, owner);
      const claim = stored?.funding_requested_at === null;
      if (claim) stored!.funding_requested_at = new Date().toISOString();
      return Response.json(claim);
    }
    assert.equal(url.pathname, '/rest/v1/game_player_wallets');
    assert.equal(url.searchParams.get('world_id'), `eq.${world}`);
    if (r.method === 'PATCH') { Object.assign(stored!, body); return new Response(null, { status: 204 }); }
    return Response.json(stored ? [{ ...stored, private_key: extra }] : []);
  };
  const db = createClient('https://example.supabase.co', 'server-test-key', { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
  return { db, fetcher, calls: () => faucetCalls, putUnexpectedSecret: () => { extra = secret; }, exists: () => { chainExists = true; } };
}

test('new server-held key funds once, checks final chain key/balance, and returns no secret fields', async () => {
  const f = fixture();
  const first = await playerWallet(f.db, world, owner, true, f.fetcher);
  assert.ok(first?.funded_at);assert.equal(f.calls(), 1);
  f.putUnexpectedSecret();
  const second = await playerWallet(f.db, world, owner, true, f.fetcher);
  assert.deepEqual(second, first);assert.equal(f.calls(), 1);
  assert.ok(!('private_key' in second!));assert.ok(!('secret_id' in second!));
});

test('readonly status never allocates a key or starts funding', async () => {
  const f = fixture();
  assert.equal(await playerWallet(f.db, world, owner, false, f.fetcher), null);assert.equal(f.calls(), 0);
});

test('lost faucet response reconciles from chain without another funding request', async () => {
  const f = fixture({ disconnected: true });
  assert.ok((await playerWallet(f.db, world, owner, true, f.fetcher))?.funded_at);
  await playerWallet(f.db, world, owner, true, f.fetcher);assert.equal(f.calls(), 1);
});

test('rate-limited faucet remains pending across repeated setup and later confirms external funding', async () => {
  const f = fixture({ faucetStatus: 429 });
  const first = await playerWallet(f.db, world, owner, true, f.fetcher);
  assert.equal(first?.funded_at, null);assert.equal(first?.faucet_http_status, 429);
  await playerWallet(f.db, world, owner, true, f.fetcher);assert.equal(f.calls(), 1);
  f.exists();
  assert.ok((await playerWallet(f.db, world, owner, false, f.fetcher))?.funded_at);assert.equal(f.calls(), 1);
});

test('unreachable RPC and mismatched onchain keys cannot request funds or mark ready', async () => {
  for (const options of [{ rpcDown: true }, { preexisting: true, mismatch: true }]) {
    const f = fixture(options);
    assert.equal((await playerWallet(f.db, world, owner, true, f.fetcher))?.funded_at, null);assert.equal(f.calls(), 0);
  }
});

test('allocation failure cannot trigger a public funding request', async () => {
  const f = fixture({ capacity: true });
  await assert.rejects(playerWallet(f.db, world, owner, true, f.fetcher), /setup could not be saved/);assert.equal(f.calls(), 0);
});
