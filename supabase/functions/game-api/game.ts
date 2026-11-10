import type { SupabaseClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import { KeyPair } from '@near-js/crypto';
import {baseEncode} from '@near-js/utils';
import { buildDelegateAction, encodeDelegateAction, decodeSignedTransaction } from '@near-js/transactions';
import { actions, account, access, digest, NEAR, rpc, sign, signature, TGAS, view, type Action } from './near.ts';
import { recordedNeed } from './recorded-need.ts';
import { decide, marketProgress, merchants, needFor } from './market.ts';

export type World = { id: string; status: string; contract_id: string | null; is_active?:boolean };
export type Context = { db: SupabaseClient; owner: string; session: string; world: World; player: string; fetcher: typeof fetch; namespace?:string };
type Plan = { role: string; receiver: string; actions: Action[]; servedDay?: number };
export type Record = { request_id: string; action: any; status: string; claim_id: string; signed_tx: string | null; tx_hash: string; signer_id: string; result: any; error: string | null };
export const roles = ['owner', 'mira', 'rowan', 'bram', 'customer', 'treasury'] as const;
export const ingredients = ['sunleaf', 'moonmint', 'emberbloom', 'spring_water', 'wood_essence', 'silver_dust'];
export const potions = ['healing_tonic', 'focus_draught', 'restoration_elixir'];
export function ids(player: string, namespace?:string) {
  const owner = namespace || `town.${player}`;
  return { player, owner, contract: `items.${owner}`, mira: `mira.${owner}`, rowan: `rowan.${owner}`, bram: `bram.${owner}`, customer: `customer.${owner}`, treasury: `treasury.${owner}` };
}
export async function dbCall(c: Context, name: string, params: object) {
  const { data, error } = await c.db.rpc(name, params);
  if (error) throw new Error(error.code === '23505' ? 'Request ID belongs to another action.' : error.code === '55P03' ? 'A previous action needs confirmation. Refresh the ledger.' : 'The durable game record could not be updated.');
  return data;
}
export const namesFor=(c:Context)=>ids(c.player,c.namespace);
export async function key(c: Context, role: string) {
  if(c.namespace&&role==='player')throw Error('The server has no player signing key.');
  const secret = await dbCall(c, 'game_signing_key', { p_world: c.world.id, p_owner: c.owner, p_session: c.session, p_role: role });
  if (typeof secret !== 'string' || !secret.startsWith('ed25519:')) throw new Error('The game signing key is unavailable.');
  return KeyPair.fromString(secret as `ed25519:${string}`);
}
export function publicOperation(op: Record) { return { status: op.status, result: op.result, error: op.error }; }
export async function operation(c: Context, request: string) {
  const { data, error } = await c.db.from('game_operations').select('*').eq('world_id', c.world.id).eq('request_id', request).maybeSingle();
  if (error) throw new Error('Action record unavailable.');
  return data as Record | null;
}
async function finish(c: Context, op: Record, status: string, result: object, error: string | null) {
  await dbCall(c, 'finish_game_operation', { p_world: c.world.id, p_request: op.request_id, p_status: status, p_result: result, p_error: error });
  return (await operation(c, op.request_id))!;
}
export async function reconcile(c: Context, op: Record): Promise<Record> {
  if (op.status === 'preparing') op = await dbCall(c, 'begin_game_operation', { p_world: c.world.id, p_owner: c.owner, p_request: op.request_id, p_action: op.action });
  if (op.status !== 'pending') return op;
  try {
    // Re-broadcasting the exact saved bytes is safe across cold starts; never rebuild an uncertain transaction.
    await rpc('send_tx', { signed_tx_base64: op.signed_tx, wait_until: 'NONE' }, c.fetcher).catch(() => null);
    const result = await rpc('tx', { tx_hash: op.tx_hash, sender_account_id: op.signer_id, wait_until: 'FINAL' }, c.fetcher);
    if (result.final_execution_status !== 'FINAL' || result.transaction?.hash !== op.tx_hash || result.transaction?.signer_id !== op.signer_id) return op;
    if (result.receipts_outcome?.some((r: any) => r.outcome?.status === 'Unknown')) return op;
    const gas = [result.transaction_outcome, ...(result.receipts_outcome || [])].reduce((sum, x) => sum + BigInt(x.outcome.gas_burnt), 0n).toString();
    const receiptFailure = result.receipts_outcome?.some((r: any) => r.outcome?.status && 'Failure' in r.outcome.status);
    if (result.status?.Failure || receiptFailure) return finish(c, op, 'failed', { hash: op.tx_hash, gas_burnt: gas }, 'The action failed during execution. Refresh the ledger to check any refunded or pending refill.');
    if (result.status && 'SuccessValue' in result.status) {
      const method = op.action.kind==='market_tick' ? decodeSignedTransaction(Buffer.from(op.signed_tx!,'base64')).transaction.actions[0].functionCall?.methodName : undefined;
      if (op.action.kind==='market_tick' && !method) return op;
      // Keep the contract's returned payout/bookkeeping outcome with the confirmed receipt.
      return finish(c, op, 'confirmed', { hash: op.tx_hash, gas_burnt: gas, return_value: method==='world_view' ? '' : result.status.SuccessValue,...(method ? {method} : {}) }, null);
    }
  } catch { /* Keep the durable pending transaction for a later final-chain check. */ }
  return op;
}
export async function execute(c: Context, request: string, action: any, plan: () => Promise<Plan>) {
  let op: Record = await dbCall(c, 'begin_game_operation', { p_world: c.world.id, p_owner: c.owner, p_request: request, p_action: action });
  if (op.status !== 'preparing') return reconcile(c, op);
  // Concurrent preparations can race; the database permits only one signed payload to be saved.
  try {
    const planned = await plan();
    const signer = namesFor(c)[planned.role as keyof ReturnType<typeof ids>];
    if (!signer) throw new Error('Unknown game signer.');
    const signed = await sign(signer, planned.receiver, await key(c, planned.role), planned.actions, c.fetcher);
    const saved = await dbCall(c, 'save_game_transaction', { p_world: c.world.id, p_request: request, p_claim: op.claim_id,
      p_signed: signed.signed_tx, p_hash: signed.tx_hash, p_signer: signed.signer_id, p_day: planned.servedDay ?? null });
    if (!saved) return (await operation(c, request))!;
    op = (await operation(c, request))!;
  } catch (error) {
    // A concurrent worker may already have saved signed bytes; never clear those on a preparation error.
    const current = await operation(c, request);
    if (current?.status !== 'preparing') return current!;
    const visible = ['This customer has already visited today.', 'Put a Healing Tonic on a shelf first.', 'Guild rescue is unavailable.', 'The native refill quote is unavailable.', 'Market turn already ran or the day is complete. Refresh the ledger.', 'This world has not enabled merchant turns.', 'This world has no funded commission.', 'Complete your first crafted tonic sale.', 'Complete the Focus Draught trial first.', 'Rowan has not funded his water order.'];
    return finish(c, op, 'failed', {}, error instanceof Error && visible.includes(error.message) ? error.message : 'Action preparation failed before submission. Your confirmed inventory is preserved.');
  }
  return reconcile(c, op);
}

export async function provision(c: Context, wasm: Uint8Array) {
  if (c.world.status === 'ready') return { ready: true };
  if (c.world.status === 'paused') throw new Error('This world is paused.');
  const names = namesFor(c);
  const { data: waiting, error: waitingError } = await c.db.from('game_operations').select('*').eq('world_id', c.world.id).in('status', ['preparing', 'pending']).maybeSingle();
  if (waitingError) throw new Error('Setup status unavailable.');
  if (waiting) {
    // Begin also fences an expired preparation before the saved request is inspected again.
    let prior: Record = await dbCall(c, 'begin_game_operation', { p_world: c.world.id, p_owner: c.owner, p_request: waiting.request_id, p_action: waiting.action });
    prior = await reconcile(c, prior);
    if (['preparing','pending'].includes(prior.status)) return { ready: false, step: waiting.action.role || 'pending action', operation: publicOperation(prior) };
    if (prior.status === 'failed') return { ready: false, step: waiting.action.role || 'pending action', operation: publicOperation(prior) };
  }
  const { data: setup, error: setupError } = await c.db.from('game_operations').select('request_id,action,status').eq('world_id', c.world.id).eq('action->>kind', 'setup');
  if (setupError) throw new Error('Setup journal unavailable.');
  const completed = (role: string) => setup!.some(o => o.action.role === role && o.status === 'confirmed');
  const requestId = (role: string) => `setup-${role}-${setup!.filter(o => o.action.role === role).length}`;
  const keys = Object.fromEntries(roles.map(role => [role, KeyPair.fromRandom('ed25519').toString()]));
  await dbCall(c, 'ensure_game_runtime', { p_world: c.world.id, p_owner: c.owner, p_keys: keys });
  if(c.namespace){
    if(!await account(names.owner,c.fetcher)){
      const claimed=await dbCall(c,'claim_owned_faucet',{p_owner:c.owner,p_session:c.session,p_world:c.world.id});
      if(claimed){
        let status=null;
        try{const response=await c.fetcher('https://helper.nearprotocol.com/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:names.owner,newAccountPublicKey:(await key(c,'owner')).getPublicKey().toString()}),signal:AbortSignal.timeout(10_000),redirect:'error'});status=response.status;await response.body?.cancel();}catch{}
        const write=await c.db.from('game_owned_wallets').update({faucet_http_status:status}).eq('world_id',c.world.id);if(write.error)throw Error('Game funding outcome could not be saved.');
      }
      return {ready:false,step:'free game funding'};
    }
    await access(names.owner,await key(c,'owner'),c.fetcher);
    const funded=await c.db.from('game_owned_wallets').update({funded_at:new Date().toISOString()}).eq('world_id',c.world.id).is('funded_at',null);if(funded.error)throw Error('Game funding could not be confirmed.');
  }
  const { error: update } = await c.db.from('game_worlds').update({ status: 'provisioning', contract_id: names.contract }).eq('id', c.world.id).eq('user_id', c.owner);
  if (update) throw new Error('World setup could not be recorded.');
  for (const role of roles) {
    if (completed(role)) continue;
    const existing = await account(names[role], c.fetcher);
    if (existing) {
      await access(names[role], await key(c, role), c.fetcher);
      continue;
    }
    const request = requestId(role);
    const op = await execute(c, request, { kind: 'setup', role }, async () => ({ role: role === 'owner' ? 'player' : 'owner', receiver: names[role], actions: [
      actions.createAccount(), actions.transfer(role === 'owner' ? 8n * NEAR : NEAR / 20n),
      actions.addKey((await key(c, role)).getPublicKey(), actions.fullAccessKey()),
    ] }));
    return { ready: false, step: role, operation: publicOperation(op) };
  }
  if (!completed('contract') && !await account(names.contract, c.fetcher)) {
    const op = await execute(c, requestId('contract'), { kind: 'setup', role: 'contract' }, async () => ({ role: 'owner', receiver: names.contract, actions: [
      actions.createAccount(), actions.transfer(c.namespace?7n*NEAR:6n*NEAR), actions.deployContract(wasm),
      actions.functionCall('new', { setup: { owner_id: names.owner, player_id: c.player, merchant_ids: [names.mira, names.rowan, names.bram],
        customer_id: names.customer, treasury_id: names.treasury, refill_amount: (NEAR / 100n).toString(), operating_reserve: (NEAR / 5n).toString() } }, 100n * TGAS, 0n),
    ] }));
    return { ready: false, step: 'contract', operation: publicOperation(op) };
  }
  if(c.namespace&&(await account(names.contract,c.fetcher))?.code_hash!==baseEncode(await digest(wasm)))throw Error('The deployed shop code does not match this release.');
  const state = await view(names.contract, 'game_view', {}, c.fetcher);
  if (state.player?.account_id !== c.player || state.merchants?.length!==3 || state.merchants.some((m: any, i: number) => m.account.account_id !== [names.mira, names.rowan, names.bram][i])) throw new Error('World account configuration did not match.');
  if (!state.world?.mana_rescue || typeof state.quests?.active!=='boolean') throw new Error('Fresh shop requires the updated contract.');
  if (state.world.native_pool === '0') {
    const op = await execute(c, requestId('reserve'), { kind: 'setup', role: 'reserve' }, async () => ({ role: 'owner', receiver: names.contract,
      actions: [actions.functionCall('fund_mana', {}, 20n * TGAS, NEAR / 5n)] }));
    return { ready: false, step: 'reserve', operation: publicOperation(op) };
  }
  if (state.quests?.active===false) {
    const op=await execute(c,requestId('commissions'),{kind:'setup',role:'commissions'},async()=>({role:'owner',receiver:names.contract,actions:[actions.functionCall('open_commissions',{},20n*TGAS,0n)]}));
    return {ready:false,step:'commissions',operation:publicOperation(op)};
  }
  if (!state.quests.story) {
    const op=await execute(c,requestId('story'),{kind:'setup',role:'story'},async()=>({role:'owner',receiver:names.contract,actions:[actions.functionCall('open_story',{},20n*TGAS,0n)]}));
    return {ready:false,step:'story',operation:publicOperation(op)};
  }
  if(c.namespace&&!completed('player-gas')){
    const op=await execute(c,requestId('player-gas'),{kind:'setup',role:'player-gas'},async()=>({role:'owner',receiver:c.player,actions:[actions.transfer(NEAR/50n)]}));
    return {ready:false,step:'starting gas',operation:publicOperation(op)};
  }
  const { error } = await c.db.from('game_worlds').update({ status: 'ready' }).eq('id', c.world.id).eq('user_id', c.owner);
  if (error) throw new Error('World readiness could not be saved.');
  return { ready: true };
}

async function marketStatus(c:Context,state:any) {
  const {data,error}=await c.db.from('game_operations').select('action,result,created_at').eq('world_id',c.world.id).eq('status','confirmed').order('created_at',{ascending:true}).limit(1001);
  if (error || !Array.isArray(data)) throw new Error('Merchant journal unavailable.');
  return marketProgress(data,state.world.day);
}

async function manaStatus(c: Context, state: any) {
  const [native, price] = await Promise.all([account(c.player,c.fetcher),rpc('gas_price',[null],c.fetcher)]);
  if (!native || !integer(native.amount) || !Number.isSafeInteger(native.storage_usage) || native.storage_usage < 0 || !integer(price.gas_price) || BigInt(price.gas_price) === 0n) throw new Error('Native reserve could not be checked.');
  const spendable = BigInt(native.amount)-BigInt(native.storage_usage)*10n**19n;
  const balance = spendable > 0n ? spendable : 0n;
  // Two ordinary 20-Tgas reservations leave room for price changes before the next action.
  const low = 40n*TGAS*BigInt(price.gas_price)+1n;
  const funded = state.world.refill?.status !== 'Pending' && BigInt(state.world.native_pool) >= BigInt(state.world.refill_amount) && BigInt(state.world.refill_amount) > low;
  return { native_balance:balance.toString(),low_native:low.toString(),refill_available:funded,
    rescue_available:funded && balance < low && state.world.mana_rescue?.available === true };
}

export async function snapshot(c: Context) {
  if (c.world.status !== 'ready' || !c.world.contract_id) throw new Error('Your testnet shop is still being prepared.');
  const state = await view(c.world.contract_id, 'game_view', {}, c.fetcher);
  if (state.player.account_id !== c.player) throw new Error('Shop ownership did not match.');
  const mana = await manaStatus(c,state);
  const { data: runtime, error } = await c.db.from('game_runtime').select('served_day').eq('world_id', c.world.id).single();
  if (error) throw new Error('Customer progress unavailable.');
  state.environment = { network: 'testnet', world_id: c.world.id, contract_id: c.world.contract_id, ai_mode: 'recorded',
    ...mana,is_active:c.world.is_active!==false,starter_native: (c.namespace?NEAR/50n:2n*NEAR).toString(),...(c.namespace?{player_owned:true}: {}) };
  state.customer_need = recordedNeed;
  state.customer_available = runtime.served_day !== state.world.day;
  const { data: pending, error: pendingError } = await c.db.from('game_operations').select('request_id,status').eq('world_id', c.world.id).in('status', ['preparing', 'pending']).maybeSingle();
  if (pendingError) throw new Error('Pending actions unavailable.');
  state.pending_operation = pending;
  if (state.quests?.active && state.world.mana_rescue) {
    state.market=await marketStatus(c,state);state.market.blocked=!!pending || c.world.is_active===false;
  }
  return state;
}

const integer = (v: unknown) => typeof v === 'string' && /^[0-9]{1,39}$/.test(v) && BigInt(v) <= 2n ** 128n - 1n;
export function validateAction(a: any) {
  const shapes: { [key: string]: string[] } = { choose_alchemist:['nickname','character_id'], gather: ['token_id'], brew: ['token_id'], list: ['token_id', 'price'], unlist: ['token_id'],deliver:['token_id'],market_tick:['tick'],
    trade: ['merchant', 'token_id', 'buy', 'limit'], invest: ['merchant'], serve_customer: [], refill: [], rescue: [], next_day: [],accept_mira_order:['order_id'],deliver_mira_order:['order_id'],cancel_mira_order:['order_id'] };
  if (!a || Array.isArray(a) || typeof a.kind !== 'string' || !Object.hasOwn(shapes, a.kind)) throw new Error('Unsupported game action.');
  const keys=['kind',...shapes[a.kind],...('amount' in a && ['gather','brew','trade','deliver'].includes(a.kind) ? ['amount']:[])];
  if(Object.keys(a).sort().join()!==keys.sort().join())throw new Error('Unsupported game action.');
  if ('amount' in a && (!integer(a.amount) || BigInt(a.amount)<1n || BigInt(a.amount)>10n))throw new Error('Choose 1–10 items.');
  if(a.kind==='choose_alchemist' && (typeof a.nickname!=='string'||a.nickname!==a.nickname.trim()||[...a.nickname].length<3||[...a.nickname].length>20||! /^[\p{L}\p{N} _-]+$/u.test(a.nickname)||!['goblin','magician','dwarf','skeleton','lizard','vampire','elf','dark-elf'].includes(a.character_id)))throw new Error('Invalid alchemist.');
  if ('token_id' in a && !(a.kind === 'gather' ? ingredients : a.kind==='deliver' ? [...potions,'spring_water'] : ['brew','list','unlist'].includes(a.kind) ? potions : [...ingredients, ...potions]).includes(a.token_id)) throw new Error('Unknown item.');
  if ('tick' in a && (!Number.isSafeInteger(a.tick) || a.tick<0)) throw new Error('Invalid market turn.');
  if('order_id' in a&&(!Number.isSafeInteger(a.order_id)||a.order_id<1))throw Error('Invalid order.');
  if ('merchant' in a && !['mira','rowan','bram'].includes(a.merchant)) throw new Error('Unknown merchant.');
  if ('buy' in a && typeof a.buy !== 'boolean' || 'limit' in a && !integer(a.limit) || 'price' in a && (!integer(a.price) || BigInt(a.price) < 1n)) throw new Error('Invalid price or trade direction.');
}
export async function planAction(c: Context, a: any): Promise<Plan> {
  const names = namesFor(c), contract = names.contract;
  const state = await view(contract, 'game_view', {}, c.fetcher);
  const nonce = state.player.next_action;
  const amount=BigInt(a.amount || '1').toString();
  if(BigInt(amount)>1n && state.batch_limit!==10)throw new Error('This save needs the quantity update.');
  let method = '', args: any = {}, role = 'player', gas = 20n * TGAS, deposit = 1n, servedDay;
  switch (a.kind) {
    case 'choose_alchemist':
      if(state.batch_limit!==10 || state.alchemist)throw new Error('This game already has its alchemist or needs an update.');
      method='choose_alchemist';args={nickname:a.nickname,character_id:a.character_id,nonce};break;
    case 'deliver':
      if (!state.quests?.active) throw new Error('This world has no funded commission.');
      if (a.token_id==='spring_water' && !state.quests.story) throw new Error('Rowan has not funded his water order.');
      if (state.quests.story && ['focus_draught','restoration_elixir'].includes(a.token_id) && state.quests.story.stage===0) throw new Error('Complete your first crafted tonic sale.');
      if (state.quests.story && a.token_id==='restoration_elixir' && state.quests.story.stage===1) throw new Error('Complete the Focus Draught trial first.');
      method=amount==='1'?'deliver_commission':'deliver_many';args={token_id:a.token_id,nonce,...(amount==='1'?{}:{amount})};break;
    case 'market_tick': {
      if (!state.quests?.active || !state.world.mana_rescue) throw new Error('This world has not enabled merchant turns.');
      const market=await marketStatus(c,state);
      if (a.tick!==market.tick || market.day_ticks>=10) throw new Error('Market turn already ran or the day is complete. Refresh the ledger.');
      const actor=merchants[market.tick%3],decision=decide(state,needFor(actor,state.world.day));
      if (!decision.method) {
        // shortcut: idle turns use a zero-deposit view transaction until the journal supports idle records.
        method='world_view';role='owner';deposit=0n;break;
      }
      const wallet=state.merchants.find((m:any)=>m.account.account_id===names[actor])?.account;
      if (!Number.isSafeInteger(wallet?.next_action) || wallet.next_action<0) throw new Error('Merchant nonce unavailable.');
      method=decision.method;role=actor;args={...decision.args,nonce:wallet.next_action};break;
    }
    case 'gather': method = 'gather'; args = { token_id: a.token_id, amount, nonce }; break;
    case 'brew': method = amount==='1'?'brew':'brew_many'; args = { token_id: a.token_id, nonce,...(amount==='1'?{}:{amount}) }; break;
    case 'list': method = 'list_potion'; args = { token_id: a.token_id, price: a.price, nonce }; break;
    case 'unlist': method = 'unlist_potion'; args = { token_id: a.token_id, nonce }; break;
    case 'trade': method = 'trade'; args = { merchant_id: names[a.merchant as 'mira'], token_id: a.token_id, amount, buy: a.buy, limit: a.limit, nonce }; break;
    case 'invest': method = 'invest'; args = { merchant_id: names[a.merchant as 'mira'], nonce }; break;
    case 'next_day': method = 'advance_day'; role = 'owner'; deposit = 0n; break;
    case 'serve_customer': {
      const { data: runtime, error } = await c.db.from('game_runtime').select('served_day').eq('world_id', c.world.id).single();
      if (error || runtime.served_day === state.world.day) throw new Error('This customer has already visited today.');
      const listing = state.listings.find((l: any) => l.token_id === 'healing_tonic');
      if (!listing) throw new Error('Put a Healing Tonic on a shelf first.');
      method = 'buy_listing'; role = 'customer'; servedDay = state.world.day;
      args = { token_id: 'healing_tonic', max_price: listing.price, nonce: state.customer.next_action }; break;
    }
    case 'refill': case 'rescue': {
      const mana=await manaStatus(c,state);
      if (a.kind==='rescue' && !mana.rescue_available) throw new Error('Guild rescue is unavailable.');
      if (a.kind==='refill' && (!mana.refill_available || BigInt(state.player.balances.copper)<BigInt(state.world.refill_price))) throw new Error('The native refill quote is unavailable.');
      const playerKey = await key(c, 'player');
      const playerAccess = await access(c.player, playerKey, c.fetcher);
      const delegated = buildDelegateAction({ senderId: c.player, receiverId: contract, publicKey: playerKey.getPublicKey(),
        nonce: BigInt(playerAccess.nonce) + 1n, maxBlockHeight: BigInt(playerAccess.block_height) + 100n,
        actions: [actions.functionCall(a.kind==='rescue' ? 'request_mana_rescue' : 'request_mana_refill', { nonce }, 150n * TGAS, 1n)] });
      const delegatedSignature = signature(playerKey, await digest(encodeDelegateAction(delegated)));
      return { role: 'owner', receiver: c.player, actions: [actions.signedDelegate({ delegateAction: delegated, signature: delegatedSignature })] };
    }
    default: throw new Error('Unsupported action.');
  }
  return { role, receiver: contract, actions: [actions.functionCall(method, args, gas, deposit)], servedDay };
}
