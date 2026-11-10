import { KeyPair } from '@near-js/crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

export type PlayerWallet = {
  account_id: string; public_key: string; funding_requested_at: string | null;
  faucet_http_status: number | null; funded_at: string | null;
};
const columns = 'account_id,public_key,funding_requested_at,faucet_http_status,funded_at';
const rpcUrl = 'https://test.rpc.fastnear.com';
const faucetUrl = 'https://helper.nearprotocol.com/account';

function metadata(row: unknown): PlayerWallet {
  const w = row as PlayerWallet;
  if (!w || !/^ca-[a-f0-9]{32}\.testnet$/.test(w.account_id) || !/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w.public_key)
    || ![w.funding_requested_at, w.funded_at].every(t => t === null || typeof t === 'string' && Number.isFinite(Date.parse(t)))
    || !(w.faucet_http_status === null || Number.isInteger(w.faucet_http_status) && w.faucet_http_status >= 100 && w.faucet_http_status <= 599)) throw new Error('Unsupported wallet record');
  // Return only the public receipt fields, including when a database response gains new columns.
  return { account_id: w.account_id, public_key: w.public_key, funding_requested_at: w.funding_requested_at, faucet_http_status: w.faucet_http_status, funded_at: w.funded_at };
}

async function readWallet(db: SupabaseClient, world: string): Promise<PlayerWallet | null> {
  const { data, error } = await db.from('game_player_wallets').select(columns).eq('world_id', world).maybeSingle();
  if (error) throw new Error('Wallet record unavailable');
  return data ? metadata(data) : null;
}

async function query(fetcher: typeof fetch, params: Record<string, string>) {
  const response = await fetcher(rpcUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'wallet-check', method: 'query', params }), signal: AbortSignal.timeout(5000), redirect: 'error' });
  if (!response.ok || Number(response.headers.get('content-length') || 0) > 16384) throw new Error('Testnet RPC unavailable');
  const body = await response.text();
  if (body.length > 16384) throw new Error('Oversized RPC response');
  return JSON.parse(body);
}

async function chainState(wallet: PlayerWallet, fetcher: typeof fetch): Promise<'funded' | 'missing' | 'unavailable'> {
  try {
    const account = await query(fetcher, { request_type: 'view_account', finality: 'final', account_id: wallet.account_id });
    if (account.error?.cause?.name === 'UNKNOWN_ACCOUNT') return 'missing';
    const amount = account.result?.amount;
    if (account.error || typeof amount !== 'string' || !/^[0-9]{1,39}$/.test(amount) || BigInt(amount) <= 0n || BigInt(amount) > 2n ** 128n - 1n) return 'unavailable';
    const access = await query(fetcher, { request_type: 'view_access_key', finality: 'final', account_id: wallet.account_id, public_key: wallet.public_key });
    return !access.error && access.result?.permission === 'FullAccess' ? 'funded' : 'unavailable';
  } catch { return 'unavailable'; }
}

export async function playerWallet(db: SupabaseClient, world: string, owner: string, create: boolean, fetcher: typeof fetch): Promise<PlayerWallet | null> {
  let wallet = await readWallet(db, world);
  if (!wallet && create) {
    const key = KeyPair.fromRandom('ed25519');
    const { data, error } = await db.rpc('register_game_wallet', { p_world_id: world, p_owner_id: owner, p_public_key: key.getPublicKey().toString(), p_secret_key: key.toString() });
    if (error || !Array.isArray(data) || data.length !== 1) throw new Error('Wallet setup could not be saved');
    wallet = metadata(data[0]);
  }
  if (!wallet || wallet.funded_at) return wallet;

  let state = await chainState(wallet, fetcher);
  if (create && state === 'missing' && !wallet.funding_requested_at) {
    const { data: claimed, error } = await db.rpc('claim_game_wallet_faucet', { p_world_id: world, p_owner_id: owner });
    if (error) throw new Error('Funding request could not be reserved');
    if (claimed === true) {
      let status: number | null = null;
      try {
        const response = await fetcher(faucetUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newAccountId: wallet.account_id, newAccountPublicKey: wallet.public_key }), signal: AbortSignal.timeout(10_000), redirect: 'error' });
        status = response.status;
        await response.body?.cancel();
      } catch { /* A reserved request is never automatically repeated after a disconnect. */ }
      const { error: writeError } = await db.from('game_player_wallets').update({ faucet_http_status: status }).eq('world_id', world);
      if (writeError) throw new Error('Funding outcome could not be recorded');
      state = await chainState(wallet, fetcher);
    }
  }
  if (state === 'funded') {
    const { error } = await db.from('game_player_wallets').update({ funded_at: new Date().toISOString() }).eq('world_id', world).is('funded_at', null);
    if (error) throw new Error('Funding confirmation could not be saved');
  }
  return readWallet(db, world);
}
