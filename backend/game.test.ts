import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { KeyPair } from '@near-js/crypto';
import { decodeSignedTransaction, encodeTransaction } from '@near-js/transactions';
import { baseEncode } from '@near-js/utils';
import { createGameHandler } from '../supabase/functions/game-api/handler.ts';
import { execute, ids, operation, planAction, provision, publicOperation, reconcile, snapshot, validateAction, type Context } from '../supabase/functions/game-api/game.ts';
import { digest } from '../supabase/functions/game-api/near.ts';
import { recordedNeed } from '../supabase/functions/game-api/recorded-need.ts';
import sample from './fixtures/jev-recorded-sample.json' with { type: 'json' };
import policyCases from './fixtures/merchant-policy-cases.json' with {type:'json'};

const world = '20000000-0000-4000-8000-000000000001';
const owner = '10000000-0000-4000-8000-000000000001';
const session = '30000000-0000-4000-8000-000000000001';
const player = 'ca-' + world.replaceAll('-', '') + '.testnet';
const names = ids(player);
const config = { url: 'https://example.supabase.co', publishableKey: 'public-test-key', secretKey: 'server-test-key', origins: ['http://localhost:5173'], wasm: new Uint8Array() };
function token(exp = Math.floor(Date.now()/1000)+3600) {
  return ['header', Buffer.from(JSON.stringify({ sub: owner, session_id: session, exp })).toString('base64url'), 'fake-signature'].join('.');
}
function request(path: string, body?: object, bearer = token()) { return new Request('https://example.supabase.co/functions/v1/game-api'+path,
  { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer '+bearer, 'Content-Type':'application/json', Origin: config.origins[0] }, body: body ? JSON.stringify(body) : undefined }); }
function fixture(options: { inactive?:boolean;revoked?: boolean; pending?: boolean; failure?: boolean; receiptFailure?: boolean;receiptUnknown?:boolean;coins?:string;native?:string;rescueUsed?:boolean;pool?:string;gasPrice?:string;state?:any;history?:any[];savedWorlds?:any[] } = {}) {
  const records = new Map<string, any>();
  const key = KeyPair.fromRandom('ed25519');
  let signedCount = 0, ready = !options.pending, revoked = !!options.revoked, servedDay: number | null = null;
  const broadcasts: string[] = [];
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const r = new Request(input, init), url = new URL(r.url);
    const b = r.method === 'POST' || r.method === 'PATCH' ? await r.json() : null;
    calls.push(url.pathname);
    if (url.hostname === 'test.rpc.fastnear.com') {
      assert.equal(r.headers.get('Authorization'), null);
      if (b.method === 'send_tx') {
        const tx = decodeSignedTransaction(Buffer.from(b.params.signed_tx_base64, 'base64'));
        const hash = baseEncode(await digest(encodeTransaction(tx.transaction)));
        assert.ok(key.verify(await digest(encodeTransaction(tx.transaction)), new Uint8Array(tx.signature.ed25519Signature!.data)));
        const saved = [...records.values()].find(op => op.tx_hash === hash);
        assert.ok(saved, 'Signed transaction must be durable before any broadcast');
        assert.equal(saved.status, 'pending');
        const delegated=['refill','rescue'].includes(saved.action.kind);
        assert.equal(tx.transaction.receiverId, delegated ? player : names.contract);
        if (saved.action.kind!=='market_tick') assert.equal(tx.transaction.signerId, delegated || saved.action.kind==='next_day' || ['commissions','story'].includes(saved.action.role) ? names.owner : player);
        broadcasts.push(b.params.signed_tx_base64);
        return Response.json({ result: { final_execution_status: 'NONE' } });
      }
      if (b.method === 'tx') {
        if (!ready) throw new Error('Simulated RPC disconnect');
        const saved=[...records.values()].find(op=>op.tx_hash===b.params.tx_hash);
        return Response.json({ result: { final_execution_status: 'FINAL', transaction: { hash: b.params.tx_hash, signer_id: saved.signer_id },
          transaction_outcome: { outcome: { gas_burnt: 100 } }, receipts_outcome: [{ outcome: { gas_burnt: 200, status:options.receiptUnknown ? 'Unknown' : options.receiptFailure ? {Failure:{}} : {SuccessValue:''} } }],
          status: options.failure ? { Failure: {} } : { SuccessValue: '' } } });
      }
      if (b.method==='gas_price') return Response.json({result:{gas_price:options.gasPrice ?? '100000000'}});
      assert.equal(b.method, 'query');
      if (b.params.request_type==='view_account') return Response.json({result:{amount:options.native ?? '10000000000000000000000000',storage_usage:0}});
      if (b.params.request_type === 'view_access_key') return Response.json({ result: { permission: 'FullAccess', nonce: 10, block_height: 500, block_hash: baseEncode(new Uint8Array(32)) } });
      assert.equal(b.params.account_id, names.contract);
      return Response.json({ result: { result: [...Buffer.from(JSON.stringify(options.state ?? { player: { account_id:player,next_action: 0,balances:{copper:options.coins ?? '40'} }, customer: { next_action: 0 }, world: { day: 0,native_pool:options.pool ?? '200000000000000000000000',refill_amount:'10000000000000000000000',refill_price:'10',mana_rescue:{used:!!options.rescueUsed,pending:false,available:!options.rescueUsed&&BigInt(options.coins ?? '40')<10n} }, listings: [{ token_id: 'healing_tonic', price: '13' }] }))] } });
    }
    assert.equal(url.hostname, 'example.supabase.co');
    if (url.pathname === '/auth/v1/user') return Response.json({ id: owner, email_confirmed_at: '2026-11-05T00:00:00Z', is_anonymous: false });
    assert.equal(r.headers.get('Authorization'), 'Bearer server-test-key');
    if (url.pathname.includes('/rpc/')) {
      const rpc = url.pathname.split('/').at(-1);
      if (rpc === 'game_session_active') return Response.json(!revoked);
      if (rpc === 'ensure_game_runtime') return Response.json(null);
      if (rpc === 'game_signing_key') { signedCount++; assert.equal(b.p_owner, owner); assert.equal(b.p_session, session); return Response.json(key.toString()); }
      if (rpc === 'begin_game_operation') {
        const old = records.get(b.p_request);
        if (old) return isDeepStrictEqual(old.action,b.p_action) ? Response.json(old) : Response.json({ code:'23505' }, { status: 400 });
        if ([...records.values()].some(op=>['preparing','pending'].includes(op.status))) return Response.json({code:'55P03'},{status:400});
        const op = { request_id: b.p_request, action: b.p_action, status: 'preparing', claim_id: 'fake-claim', result: {}, error: null };
        records.set(b.p_request, op); return Response.json(op);
      }
      if (rpc === 'save_game_transaction') {
        const op = records.get(b.p_request);
        if (op.status !== 'preparing') return Response.json(false);
        Object.assign(op, { signed_tx: b.p_signed, tx_hash: b.p_hash, signer_id: b.p_signer, served_day: b.p_day, status: 'pending' });
        return Response.json(true);
      }
      if (rpc === 'finish_game_operation') {
        const op = records.get(b.p_request);
        Object.assign(op, { status: b.p_status, result: b.p_result, error: b.p_error });
        if (op.status === 'confirmed' && op.served_day !== null) servedDay = op.served_day;
        return Response.json(null);
      }
      if(rpc==='prepare_fresh_game_world')return Response.json('20000000-0000-4000-8000-000000000002');
      if(rpc==='activate_game_world')return Response.json(b.p_world);
      throw new Error('Unexpected database RPC');
    }
    if (url.pathname.endsWith('/game_worlds')) {
      assert.equal(url.searchParams.get('user_id'), `eq.${owner}`);
      if (url.searchParams.has('id')) { if (url.searchParams.get('id')!==`eq.${world}`) return Response.json([]); }
      else {if(url.searchParams.has('is_active'))assert.equal(url.searchParams.get('is_active'),'eq.true');if(options.inactive)return Response.json([]);}
      const worlds=options.savedWorlds ?? [{id:world,status:'ready',contract_id:names.contract,is_active:!options.inactive}]; return Response.json(worlds.filter(w=>(!url.searchParams.has('id')||url.searchParams.get('id')==='eq.'+w.id)&&(!url.searchParams.has('is_active')||w.is_active)));
    }
    if (url.pathname.endsWith('/game_player_wallets')) { assert.equal(url.searchParams.get('world_id'), `eq.${world}`); return Response.json({ account_id: player, funded_at: '2026-11-05T00:00:00Z' }); }
    if (url.pathname.endsWith('/game_runtime')) return Response.json({ served_day: servedDay });
    assert.equal(url.pathname, '/rest/v1/game_operations');
    assert.equal(url.searchParams.get('world_id'), `eq.${world}`);
    if (!url.searchParams.has('request_id')) {
      const rows=[...(options.history ?? []),...records.values()];
      return Response.json(rows.filter(op=>url.searchParams.get('status')==='eq.confirmed' ? op.status==='confirmed' : ['preparing','pending'].includes(op.status)));
    }
    const op = records.get(url.searchParams.get('request_id')!.slice(3));
    return Response.json(op ? [op] : []);
  };
  const db = createClient(config.url, config.secretKey, { global: { fetch: fetcher }, auth: { persistSession: false, autoRefreshToken: false } });
  const c: Context = { db, owner, session, world: { id: world, status:'ready', contract_id: names.contract }, player, fetcher };
  return { c, fetcher, broadcasts, calls, signed:()=>signedCount, confirm:()=>{ready=true;},revoke:()=>{revoked=true;},renew:()=>{revoked=false;},records };
}

test('game routes reject malformed, expired, revoked and foreign-world requests before keys are read', async () => {
  const f = fixture(), handler = createGameHandler(config, f.fetcher);
  assert.equal((await handler(request('/action', { request_id:crypto.randomUUID(),world_id:world,action:{kind:'gather',token_id:'sunleaf',amount:'999'} }))).status,400);
  assert.equal((await handler(request('/state', undefined, token(1)))).status,401);
  assert.equal((await handler(request('/action', {request_id:crypto.randomUUID(),world_id:'40000000-0000-4000-8000-000000000001',action:{kind:'brew',token_id:'healing_tonic'}}))).status,403);
  const revoked=fixture({revoked:true});
  assert.equal((await createGameHandler(config,revoked.fetcher)(request('/state'))).status,401);
  assert.equal(f.signed(),0);assert.equal(revoked.signed(),0);
});

test('signed gather is persisted before sending; duplicate and a new handler reuse its confirmed receipt', async () => {
  const f=fixture(), requestId=crypto.randomUUID(), body={request_id:requestId,world_id:world,action:{kind:'gather',token_id:'sunleaf'}};
  const first=await (await createGameHandler(config,f.fetcher)(request('/action',body))).json();
  assert.equal(first.status,'confirmed');assert.equal(first.result.gas_burnt,'300');
  const restored=await (await createGameHandler(config,f.fetcher)(request('/action',body))).json();
  assert.deepEqual(restored,first);assert.equal(f.signed(),1);assert.equal(f.broadcasts.length,1);
  assert.ok(!JSON.stringify(first).includes('signed_tx'));assert.ok(!JSON.stringify(first).includes('ed25519:'));
});

test('disconnect leaves durable pending bytes; a new context reconciles those exact bytes without signing again', async () => {
  const f=fixture({pending:true}), id=crypto.randomUUID(), action={kind:'brew',token_id:'healing_tonic'};
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'pending');
  f.confirm();
  const restored=await reconcile({...f.c},(await operation(f.c,id))!);
  assert.equal(restored.status,'confirmed');assert.equal(f.signed(),1);
  assert.equal(f.broadcasts.length,2);assert.equal(f.broadcasts[0],f.broadcasts[1]);
});

test('repeated outage checks and session renewal preserve one signed action across handler replacements',async()=>{
  const f=fixture({pending:true}),id=crypto.randomUUID(),body={request_id:id,world_id:world,action:{kind:'brew',token_id:'healing_tonic'}};
  assert.equal((await(await createGameHandler(config,f.fetcher)(request('/action',body))).json()).status,'pending');
  const saved=structuredClone(f.records.get(id));
  for(let attempt=0;attempt<20;attempt++) {
    assert.equal((await(await createGameHandler(config,f.fetcher)(request('/actions/'+id))).json()).status,'pending');
    assert.deepEqual(f.records.get(id),saved);assert.equal(f.signed(),1);
  }
  const competing=await createGameHandler(config,f.fetcher)(request('/action',{...body,request_id:crypto.randomUUID()}));
  assert.equal(competing.status,503);assert.match((await competing.json()).error,/previous action needs confirmation/);
  f.revoke();const broadcasts=f.broadcasts.length;
  assert.equal((await createGameHandler(config,f.fetcher)(request('/actions/'+id))).status,401);
  assert.equal(f.broadcasts.length,broadcasts);assert.deepEqual(f.records.get(id),saved);
  f.renew();f.confirm();
  const final=await(await createGameHandler(config,f.fetcher)(request('/actions/'+id))).json();
  assert.equal(final.status,'confirmed');assert.equal(f.signed(),1);
  assert.ok(f.broadcasts.every(bytes=>bytes===saved.signed_tx));
  assert.deepEqual(await(await createGameHandler(config,f.fetcher)(request('/action',body))).json(),final);
  const conflict=await createGameHandler(config,f.fetcher)(request('/action',{...body,action:{kind:'brew',token_id:'focus_draught'}}));
  assert.equal(conflict.status,503);assert.equal(f.signed(),1);assert.equal(f.records.size,1);
});

test('contract failure is terminal and cannot become a second transaction on retry', async () => {
  const f=fixture({failure:true}), id=crypto.randomUUID(), action={kind:'brew',token_id:'healing_tonic'};
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'failed');
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'failed');assert.equal(f.signed(),1);
});

test('action allowlist rejects arbitrary methods, amounts, accounts and unsafe integer prices', () => {
  for (const action of [{kind:'transfer',receiver_id:'foreign.testnet'}, {kind:'gather',token_id:'copper'}, {kind:'trade',merchant:'foreign',token_id:'sunleaf',buy:true,limit:'1'},
    {kind:'list',token_id:'healing_tonic',price:(2n**128n).toString()}, {kind:'brew',token_id:'healing_tonic',nonce:0}, {kind:'refill',amount:'100000'}]) assert.throws(()=>validateAction(action));
  validateAction({kind:'trade',merchant:'mira',token_id:'sunleaf',buy:false,limit:'1'});
});

test('preparation errors cannot leak signing secrets or create broadcasts', async () => {
  const f=fixture();
  const result=publicOperation(await execute(f.c,crypto.randomUUID(),{kind:'brew'},async()=>{throw new Error('server-secret');}));
  assert.equal(result.status,'failed');assert.ok(!JSON.stringify(result).includes('server-secret'));assert.equal(f.broadcasts.length,0);
});

test('hosted customer excerpt matches the existing recorded Jev evidence', () => {
  assert.deepEqual(recordedNeed, { text: sample.request.questions.scraped_hand.instructions.customer_need, source:'recorded',model:sample.result.model,
    probability:sample.result.probabilities.scraped_hand,judgment:sample.decisions.scraped_hand,recorded_at:sample.completed_at,request_sha256:sample.request_sha256 });
});

test('rescue delegates only the fixed player request, persists it, and reuses those bytes after disconnect',async()=>{
  const f=fixture({coins:'0',native:'0',pending:true});
  const id=crypto.randomUUID(),action={kind:'rescue'};validateAction(action);
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'pending');
  const tx=decodeSignedTransaction(Buffer.from(f.broadcasts[0],'base64'));
  const delegated=tx.transaction.actions[0].signedDelegate!.delegateAction;
  assert.equal(tx.transaction.signerId,names.owner);assert.equal(tx.transaction.receiverId,player);
  assert.equal(delegated.senderId,player);assert.equal(delegated.receiverId,names.contract);
  const method=delegated.actions[0].functionCall!;
  assert.equal(method.methodName,'request_mana_rescue');assert.equal(method.deposit,1n);
  assert.deepEqual(JSON.parse(Buffer.from(method.args).toString()),{nonce:0});
  assert.equal(f.signed(),2);f.confirm();
  assert.equal((await execute({...f.c},id,action,()=>planAction(f.c,action))).status,'confirmed');
  assert.equal(f.signed(),2);assert.equal(f.broadcasts.length,2);assert.equal(f.broadcasts[0],f.broadcasts[1]);
});

test('unfunded, used, sufficiently funded or malformed rescue requests cannot read signing keys',async()=>{
  for(const options of [{coins:'10',native:'0'},{coins:'0',native:'10000000000000000000000000'},{coins:'0',native:'0',rescueUsed:true},{coins:'0',native:'0',pool:'0'},{coins:'0',native:'0',gasPrice:'broken'},{coins:'0',native:'0',gasPrice:'1000000000'}]) {
    const f=fixture(options);
    await assert.rejects(()=>planAction(f.c,{kind:'rescue'}));
    assert.equal(f.signed(),0);assert.equal(f.broadcasts.length,0);
  }
  assert.throws(()=>validateAction({kind:'rescue',amount:'1000000000'}));
});

test('a failed inner delegated receipt is terminal even if the outer transaction succeeded',async()=>{
  const f=fixture({coins:'0',native:'0',receiptFailure:true}),id=crypto.randomUUID(),action={kind:'rescue'};
  const first=await execute(f.c,id,action,()=>planAction(f.c,action));
  assert.equal(first.status,'failed');assert.ok(first.result.hash);
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'failed');
  assert.equal(f.broadcasts.length,1);assert.equal(f.signed(),2);
});

test('an unknown inner receipt keeps the original rescue pending without a new signature',async()=>{
  const f=fixture({coins:'0',native:'0',receiptUnknown:true}),id=crypto.randomUUID(),action={kind:'rescue'};
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'pending');
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'pending');
  assert.equal(f.signed(),2);assert.equal(f.broadcasts[0],f.broadcasts[1]);
});

function merchantState() {
  const state=structuredClone(policyCases.base) as any;
  state.player={...state.player,account_id:player,next_action:0,balances:{...state.player.balances,copper:'40'}};
  state.customer={next_action:0};
  Object.assign(state.world,{native_pool:'200000000000000000000000',refill_amount:'10000000000000000000000',refill_price:'10',mana_rescue:{used:false,pending:false,available:false}});
  state.quests={active:true};
  state.merchants.forEach((m:any,i:number)=>{m.account.account_id=names[['mira','rowan','bram'][i] as 'mira'];m.account.next_action=0;});
  return state;
}

test('merchant turns use the NPC signer and restore counters/receipt after a cold context',async()=>{
  const state=merchantState(),f=fixture({state}),id=crypto.randomUUID(),action={kind:'market_tick',tick:0};
  validateAction(action);
  assert.equal((await execute(f.c,id,action,()=>planAction(f.c,action))).status,'confirmed');
  const tx=decodeSignedTransaction(Buffer.from(f.broadcasts[0],'base64'));
  assert.equal(tx.transaction.signerId,names.mira);assert.equal(tx.transaction.receiverId,names.contract);
  assert.equal(tx.transaction.actions[0].functionCall!.methodName,'buy_listing');
  const restored=await snapshot({...f.c});
  assert.equal(restored.market.tick,1);assert.equal(restored.market.day_ticks,1);
  assert.equal(restored.market.events[0].decision.method,'buy_listing');
  assert.equal(restored.market.source,'cached_jev');
  assert.equal((await execute({...f.c},id,action,()=>planAction(f.c,action))).status,'confirmed');
  await assert.rejects(()=>planAction(f.c,{kind:'market_tick',tick:0}));
  assert.equal(f.signed(),1);assert.equal(f.broadcasts.length,1);
  const next={kind:'next_day'};
  assert.equal((await execute(f.c,crypto.randomUUID(),next,()=>planAction(f.c,next))).status,'confirmed');
  state.world.day=1;
  const tomorrow=await snapshot({...f.c});
  assert.equal(tomorrow.market.tick,1);assert.equal(tomorrow.market.day_ticks,0);
  assert.equal(tomorrow.market.events[0].day,0);
});

test('idle turns have a funded owner checkpoint; complete days reject another turn before key access',async()=>{
  const state=merchantState();state.merchants[0].open=false;
  const f=fixture({state}),action={kind:'market_tick',tick:0};
  assert.equal((await execute(f.c,crypto.randomUUID(),action,()=>planAction(f.c,action))).status,'confirmed');
  const tx=decodeSignedTransaction(Buffer.from(f.broadcasts[0],'base64'));
  assert.equal(tx.transaction.signerId,names.owner);
  assert.equal(tx.transaction.actions[0].functionCall!.methodName,'world_view');
  assert.equal(tx.transaction.actions[0].functionCall!.deposit,0n);
  const history=Array.from({length:10},(_,tick)=>({status:'confirmed',action:{kind:'market_tick',tick},result:{method:'world_view'}}));
  const complete=fixture({state,history});
  await assert.rejects(()=>planAction(complete.c,{kind:'market_tick',tick:10}));
  assert.equal(complete.signed(),0);assert.equal(complete.broadcasts.length,0);
});

test('quest delivery is fixed to the owned world contract and older contracts cannot enable new actions',async()=>{
  const f=fixture({state:merchantState()}),action={kind:'deliver',token_id:'healing_tonic'};
  validateAction(action);
  assert.equal((await execute(f.c,crypto.randomUUID(),action,()=>planAction(f.c,action))).status,'confirmed');
  const tx=decodeSignedTransaction(Buffer.from(f.broadcasts[0],'base64'));
  assert.equal(tx.transaction.signerId,player);assert.equal(tx.transaction.receiverId,names.contract);
  assert.equal(tx.transaction.actions[0].functionCall!.methodName,'deliver_commission');
  const old=fixture();await assert.rejects(()=>planAction(old.c,action));
  await assert.rejects(()=>planAction(old.c,{kind:'market_tick',tick:0}));assert.equal(old.signed(),0);
  for(const invalid of [{kind:'market_tick',tick:-1},{kind:'market_tick',tick:0,merchant:'mira'},{kind:'deliver',token_id:'sunleaf'},{kind:'deliver',token_id:'healing_tonic',reward:'999'}]) assert.throws(()=>validateAction(invalid));
});

test('quest stages reject locked deliveries before key access and water uses the player signer',async()=>{
  const state=merchantState();state.quests.story={stage:0};
  const f=fixture({state});
  for(const token_id of ['focus_draught','restoration_elixir']) {
    const action={kind:'deliver',token_id};validateAction(action);
    await assert.rejects(()=>planAction(f.c,action),/first crafted tonic sale/);
  }
  state.quests.story.stage=1;
  await assert.rejects(()=>planAction(f.c,{kind:'deliver',token_id:'restoration_elixir'}),/Focus Draught trial/);
  assert.equal(f.signed(),0);assert.equal(f.broadcasts.length,0);
  for(const [token_id,stage] of [['focus_draught',1],['restoration_elixir',2],['spring_water',0]] as const) {
    state.quests.story.stage=stage;
    const action={kind:'deliver',token_id};validateAction(action);
    assert.equal((await execute(f.c,crypto.randomUUID(),action,()=>planAction(f.c,action))).status,'confirmed');
    const tx=decodeSignedTransaction(Buffer.from(f.broadcasts.at(-1)!,'base64'));
    assert.equal(tx.transaction.signerId,player);assert.equal(tx.transaction.receiverId,names.contract);
    assert.equal(tx.transaction.actions[0].functionCall!.methodName,'deliver_commission');
    const args=JSON.parse(new TextDecoder().decode(new Uint8Array(tx.transaction.actions[0].functionCall!.args)));
    assert.equal(args.token_id,token_id);
  }
  delete state.quests.story;
  await assert.rejects(()=>planAction(f.c,{kind:'deliver',token_id:'spring_water'}),/funded/);
  assert.equal(f.signed(),3);assert.equal(f.broadcasts.length,3);
});

test('new-world provisioning funds commissions and story once before declaring the shop ready',async()=>{
  const state=merchantState();state.quests.active=false;
  const f=fixture({state});f.c.world.status='provisioning';
  const first=await provision(f.c,new Uint8Array());
  assert.equal(first.ready,false);assert.equal(first.step,'commissions');
  const tx=decodeSignedTransaction(Buffer.from(f.broadcasts[0],'base64'));
  assert.equal(tx.transaction.signerId,names.owner);
  assert.equal(tx.transaction.actions[0].functionCall!.methodName,'open_commissions');
  assert.equal(tx.transaction.actions[0].functionCall!.deposit,0n);
  state.quests.active=true;
  const story=await provision({...f.c},new Uint8Array());
  assert.equal(story.ready,false);assert.equal(story.step,'story');
  const storyTx=decodeSignedTransaction(Buffer.from(f.broadcasts[1],'base64'));
  assert.equal(storyTx.transaction.signerId,names.owner);
  assert.equal(storyTx.transaction.actions[0].functionCall!.methodName,'open_story');
  assert.equal(storyTx.transaction.actions[0].functionCall!.deposit,0n);
  state.quests.story={stage:0};
  assert.equal((await provision({...f.c},new Uint8Array())).ready,true);
  assert.equal(f.broadcasts.length,2);
});

test('fresh provisioning cannot mark an old or incomplete contract ready',async()=>{
  const state=merchantState();delete state.quests;
  const f=fixture({state});f.c.world.status='provisioning';
  await assert.rejects(()=>provision(f.c,new Uint8Array()),/updated contract/);
  assert.equal(f.broadcasts.length,0);
  const old=fixture();assert.deepEqual(await provision(old.c,new Uint8Array()),{ready:true});
  assert.equal(old.broadcasts.length,0);
});

test('quantities and permanent identity reject malformed input before signing and bind valid batches to one owned call',async()=>{
  for(const action of [{kind:'gather',token_id:'sunleaf',amount:'0'},{kind:'brew',token_id:'healing_tonic',amount:'11'},{kind:'trade',merchant:'mira',token_id:'sunleaf',buy:true,limit:'20',amount:2},{kind:'choose_alchemist',nickname:'<script>',character_id:'goblin'}])assert.throws(()=>validateAction(action));
  const state=merchantState();state.batch_limit=10;state.alchemist=null;const f=fixture({state});
  for(const [action,method] of [[{kind:'brew',token_id:'healing_tonic',amount:'2'},'brew_many'],[{kind:'gather',token_id:'sunleaf',amount:'4'},'gather'],[{kind:'deliver',token_id:'healing_tonic',amount:'2'},'deliver_many'],[{kind:'choose_alchemist',nickname:'New Alchemist',character_id:'dwarf'},'choose_alchemist']] as const){
    validateAction(action);assert.equal((await execute(f.c,crypto.randomUUID(),action,()=>planAction(f.c,action))).status,'confirmed');
    const tx=decodeSignedTransaction(Buffer.from(f.broadcasts.at(-1)!,'base64'));assert.equal(tx.transaction.signerId,player);assert.equal(tx.transaction.receiverId,names.contract);
    assert.equal(tx.transaction.actions.length,1);assert.equal(tx.transaction.actions[0].functionCall!.methodName,method);
  }
  state.alchemist={nickname:'New Alchemist',character_id:'dwarf'};
  await assert.rejects(()=>planAction(f.c,{kind:'choose_alchemist',nickname:'Changed',character_id:'elf'}));
  delete state.batch_limit;await assert.rejects(()=>planAction(f.c,{kind:'brew',token_id:'healing_tonic',amount:'2'}));assert.equal(f.signed(),4);
});

test('new save preparation is owned, preserves the previous save and does not access funding or signing keys',async()=>{
  const f=fixture(),handler=createGameHandler(config,f.fetcher),body={world_id:world,request_id:crypto.randomUUID()};
  const prepared=await handler(request('/new-game',body));assert.equal(prepared.status,200);
  assert.equal((await prepared.json()).world_id,'20000000-0000-4000-8000-000000000002');
  assert.equal(f.signed(),0);assert.equal(f.broadcasts.length,0);
  assert.equal((await handler(request('/new-game',{...body,world_id:crypto.randomUUID()}))).status,403);
  const saves=[{id:world,status:'ready',contract_id:names.contract,is_active:true},{id:crypto.randomUUID(),status:'ready',contract_id:null,is_active:false}];
  const full=fixture({savedWorlds:saves});
  assert.equal((await createGameHandler(config,full.fetcher)(request('/new-game',body))).status,409);
  assert.equal(full.signed(),0);
  const fullHandler=createGameHandler(config,full.fetcher);
  assert.equal((await fullHandler(request('/select-save',{world_id:world,target_id:crypto.randomUUID(),expected_active:world}))).status,404);
  assert.equal((await fullHandler(request('/select-save',{world_id:world,target_id:saves[1].id,expected_active:crypto.randomUUID()}))).status,409);
  const switched=await fullHandler(request('/select-save',{world_id:world,target_id:saves[1].id,expected_active:world}));assert.equal(switched.status,200);
  assert.equal((await switched.json()).world_id,saves[1].id);assert.equal(full.signed(),0);
});

test('preserved legacy shops do not consume the two player-owned save slots',async()=>{
  const savedWorlds=[{id:world,status:'ready',contract_id:null,is_active:true,ownership_mode:'legacy'},{id:crypto.randomUUID(),status:'ready',contract_id:null,is_active:false,ownership_mode:'owned'}];
  const f=fixture({savedWorlds}),response=await createGameHandler(config,f.fetcher)(request('/saves'));
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.limit,3);assert.equal(body.saves.length,2);assert.equal(body.saves[0].player_owned,false);assert.equal(body.saves[1].player_owned,true);assert.equal(f.signed(),0);
});

test('inactive shops allow explicit setup and history reads, but cannot sign economic actions',async()=>{
  const f=fixture({inactive:true}),handler=createGameHandler(config,f.fetcher),query='?world_id='+world;
  assert.equal((await handler(request('/state'))).status,409);
  assert.equal((await handler(request('/provision'+query,{}))).status,200);
  const preview=await handler(request('/state'+query));assert.equal(preview.status,200);
  assert.equal((await preview.json()).environment.is_active,false);
  assert.equal((await handler(request('/actions/unknown-id'+query))).status,404);
  assert.equal((await handler(request('/action'+query,{world_id:world,request_id:crypto.randomUUID(),action:{kind:'gather',token_id:'sunleaf'}}))).status,409);
  assert.equal((await handler(request('/provision?world_id='+crypto.randomUUID(),{}))).status,409);
  assert.equal((await handler(request('/state?world_id=invalid'))).status,400);
  assert.equal((await handler(request('/state'+query+'&world_id='+world))).status,400);
  assert.equal(f.signed(),0);assert.equal(f.broadcasts.length,0);assert.equal(f.records.size,0);
});
