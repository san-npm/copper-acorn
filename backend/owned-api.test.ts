import test from 'node:test';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {KeyPair,KeyType} from '@near-js/crypto';
import {actionCreators,createTransaction,encodeTransaction,decodeSignedTransaction,SignedTransaction,Signature} from '@near-js/transactions';
import {baseEncode} from '@near-js/utils';
import {implicitAccount} from './player-identity.ts';
import {nep413Digest} from './wallet-proof.ts';
import {gameplayMethods,playerCall} from './player-action.ts';
import {signedPlayerAction,linkWallet,walletChallenge} from '../supabase/functions/game-api/owned.ts';
import {npc} from '../supabase/functions/game-api/npc.ts';
import {namesFor,snapshot,type Context} from '../supabase/functions/game-api/game.ts';
import type {Action} from '../web/src/types.ts';

function fixture(){
  const playerKey=KeyPair.fromRandom('ed25519'),gameKey=KeyPair.fromRandom('ed25519');
  const c={owner:randomUUID(),session:randomUUID(),world:{id:randomUUID(),status:'ready',contract_id:'items.ao-fictional.testnet',is_active:true},player:'fictional.testnet',namespace:'ao-fictional.testnet'} as Context;
  const state:any={batch_limit:10,player:{account_id:c.player,next_action:0,balances:{copper:'40',sunleaf:'0',spring_water:'0'}},customer:{next_action:0},world:{day:0,native_pool:'200000000000000000000000',refill_amount:'10000000000000000000000'},craft_fee:'1',catalog:[{token_id:'sunleaf',name:'Sunleaf',gather_cap:'8',gathered_today:'0',recipe:null,base_value:'4'}],merchants:[{name:'Mira',account:{account_id:namesFor(c).mira,balances:{copper:'40',sunleaf:'0'}}}]};
  const ops=new Map<string,any>(),turns=new Map<string,any>(),judgments=new Map<string,any>();
  let thread:any={turn:0,messages:[]},orders:any={completed:0,last_offer_day:null,order:null},offline=false,empty=false,permission=true,grant:any=null,modelCalls=0,offers=0,used=0,keyReads:string[]=[],challenge:any=null,proofMode='FullAccess',links=0,hint=false;
  const broadcasts:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const r=new Request(input,init),url=new URL(r.url),b=['POST','PATCH'].includes(r.method)?await r.json():null;
    if(url.hostname==='api.typesafe.ai'){
      modelCalls++;return Response.json({model:'fixture-jev',answers:{wants_work:{type:'noul',noul:hint?0.01:0.95},wants_hint:{type:'noul',noul:hint?0.95:0.02},prefers_potions:{type:'noul',noul:0.02}},usage:{input_tokens:500,output_tokens:60}});
    }
    if(url.hostname==='test.rpc.fastnear.com'){
      assert.equal(r.headers.get('authorization'),null);
      if(b.method==='send_tx'){
        const decoded=decodeSignedTransaction(Buffer.from(b.params.signed_tx_base64,'base64')),hash=baseEncode(createHash('sha256').update(encodeTransaction(decoded.transaction)).digest());
        assert.ok([...ops.values()].some(o=>o.tx_hash===hash)||grant?.tx_hash===hash,'Persist exact signed bytes before broadcasting');
        broadcasts.push(b.params.signed_tx_base64);
        if(grant?.tx_hash===hash)empty=false;
        return Response.json({result:{final_execution_status:'NONE'}});
      }
      if(b.method==='tx'){
        if(offline)throw Error('Simulated lost acknowledgement');
        const op=[...ops.values()].find(o=>o.tx_hash===b.params.tx_hash);
        if(op?.action.kind==='npc_offer'&&!orders.order){offers++;orders={...orders,last_offer_day:0,order:{id:1,token_id:op.action.token_id,amount:op.action.amount,reward:'14',status:'offered',expires_day:2}};}
        return Response.json({result:{transaction:{hash:b.params.tx_hash,signer_id:b.params.sender_account_id},final_execution_status:'FINAL',status:{SuccessValue:''},transaction_outcome:{outcome:{gas_burnt:100}},receipts_outcome:[]}});
      }
      if(b.method==='gas_price')return Response.json({result:{gas_price:'100000000'}});
      if(b.params.request_type==='view_account')return Response.json({result:{amount:empty?'0':'1000000000000000000000000',storage_usage:0}});
      if(b.params.request_type==='view_access_key')return Response.json({result:{permission:b.params.public_key===playerKey.getPublicKey().toString()?(b.params.account_id===c.player?(proofMode==='proof'? 'FullAccess':permission?{FunctionCall:{receiver_id:c.world.contract_id,method_names:gameplayMethods}}:'FullAccess'):proofMode):'FullAccess',nonce:0,block_height:500,block_hash:baseEncode(new Uint8Array(32))}});
      const value=b.params.method_name==='game_session_view'?{public_key:playerKey.getPublicKey().toString(),expires_at_ms:Date.now()+60_000,actions_left:500}:b.params.method_name==='mira_orders_view'?orders:state;
      return Response.json({result:{result:[...Buffer.from(JSON.stringify(value))]}});
    }
    assert.equal(url.hostname,'example.supabase.co');
    const name=url.pathname.split('/').at(-1)!;
    if(url.pathname.includes('/rpc/')){
      if(name==='game_signing_key'){keyReads.push(b.p_role);assert.ok(['owner','mira'].includes(b.p_role));return Response.json(gameKey.toString());}
      if(name==='begin_wallet_challenge'){challenge??={id:randomUUID(),nonce:b.p_nonce,origin:b.p_origin,expires_at:new Date(Date.now()+60_000).toISOString(),user_id:c.owner,session_id:c.session};return Response.json(challenge);}
      if(name==='bind_owned_wallet'){links++;challenge.used_at=new Date().toISOString();challenge.proof_hash=b.p_proof;return Response.json(c.world.id);}
      if(name==='begin_game_operation'){
        const op=ops.get(b.p_request);if(op)return isDeepStrictEqual(op.action,b.p_action)?Response.json(op):Response.json({code:'23505'},{status:400});
        const fresh={request_id:b.p_request,claim_id:randomUUID(),action:b.p_action,status:'preparing',result:{},error:null};ops.set(b.p_request,fresh);return Response.json(fresh);
      }
      if(name==='save_game_transaction'){Object.assign(ops.get(b.p_request),{signed_tx:b.p_signed,tx_hash:b.p_hash,signer_id:b.p_signer,status:'pending'});return Response.json(true);}
      if(name==='finish_game_operation'){Object.assign(ops.get(b.p_request),{status:b.p_status,result:b.p_result,error:b.p_error});return Response.json(null);}
      if(name==='save_owned_gas_grant'){grant??={request_id:b.p_request,signed_tx:b.p_signed,tx_hash:b.p_hash};assert.equal(grant.request_id,b.p_request);return Response.json(grant);}
      if(name==='begin_npc_turn'){
        const prior=turns.get(b.p_request);if(prior){assert.equal(prior.input_hash,b.p_hash);return Response.json({...prior,claimed:false});}
        const fresh={claim_id:randomUUID(),input_hash:b.p_hash,status:'working',claimed:true};turns.set(b.p_request,fresh);return Response.json(fresh);
      }
      if(name==='finish_npc_turn'){thread=b.p_thread;Object.assign(turns.get(b.p_request),{status:'done',result:b.p_result});return Response.json(true);}
      if(name==='reserve_npc_judgment'){
        const prior=judgments.get(b.p_request);if(prior)return Response.json({...prior,claimed:false});
        assert.ok(used<1);used++;const fresh={claim_id:randomUUID(),claimed:true};judgments.set(b.p_request,fresh);return Response.json(fresh);
      }
      if(name==='finish_npc_judgment'){judgments.get(b.p_request).result=b.p_result;return Response.json(true);}
      throw Error('Unexpected fixture RPC '+name);
    }
    if(name==='game_wallet_challenges')return Response.json(challenge);
    if(name==='game_operations'){
      const id=url.searchParams.get('request_id')?.slice(3),data=id?ops.get(id)||null:[...ops.values()];return Response.json(data);
    }
    if(name==='game_npc_threads')return Response.json({thread});
    if(name==='game_npc_budget')return Response.json({requests_used:used,request_limit:1,tokens_used:0,tokens_reserved:used*3000,token_limit:3000});
    if(name==='game_runtime')return Response.json({served_day:null});
    throw Error('Unexpected fixture table '+name);
  };
  c.fetcher=fetcher;c.db=createClient('https://example.supabase.co','fixture-key',{auth:{persistSession:false},global:{fetch:fetcher}});
  function signed(action:Action,id=randomUUID()){
    const p=playerCall(action,state),tx=createTransaction(c.player,playerKey.getPublicKey(),c.world.contract_id!,1n,[actionCreators.functionCall(p.method,Buffer.from(JSON.stringify(p.args)),20_000_000_000_000n,0n)],new Uint8Array(32));
    const digest=createHash('sha256').update(encodeTransaction(tx)).digest();
    return{request_id:id,world_id:c.world.id,action,signed_tx:Buffer.from(new SignedTransaction({transaction:tx,signature:new Signature({keyType:KeyType.ED25519,data:playerKey.sign(digest).signature})}).encode()).toString('base64')};
  }
  return{c,signed,ops,broadcasts,playerKey,hint:()=>hint=true,challenge:()=>challenge,proof:()=>proofMode='proof',offline:(v:boolean)=>offline=v,empty:()=>empty=true,permission:()=>permission=false,keys:()=>keyReads,grant:()=>grant,models:()=>modelCalls,offers:()=>offers};
}
test('hosted actions preserve the player signature through lost acknowledgements, reordered JSON and isolate recovery',async()=>{
  const f=fixture(),request=f.signed({kind:'gather',token_id:'sunleaf',amount:'2'});f.offline(true);
  assert.equal((await signedPlayerAction(f.c,request)).status,'pending');assert.equal(f.ops.size,1);assert.deepEqual(f.keys(),[]);
  const op=f.ops.get(request.request_id);op.action={amount:'2',token_id:'sunleaf',kind:'gather'};
  f.offline(false);assert.equal((await signedPlayerAction({...f.c},request)).status,'confirmed');
  assert.ok(f.broadcasts.every(b=>b===request.signed_tx));assert.equal(f.ops.size,1);
  await assert.rejects(signedPlayerAction(f.c,{...request,signed_tx:request.signed_tx.slice(0,-4)+'AAAA'}),/another signed action/);
  const invalid=fixture();invalid.permission();await assert.rejects(signedPlayerAction(invalid.c,invalid.signed({kind:'gather',token_id:'sunleaf'})),/permission/);assert.equal(invalid.broadcasts.length,0);
});
test('an empty native balance uses a bounded durable game-owned grant, never a player secret or a delegate signature',async()=>{
  const f=fixture();f.empty();const request=f.signed({kind:'refill'});
  assert.equal((await signedPlayerAction(f.c,request)).status,'confirmed');assert.deepEqual(f.keys(),['owner']);
  const grant=decodeSignedTransaction(Buffer.from(f.grant().signed_tx,'base64'));
  assert.equal(grant.transaction.receiverId,f.c.player);assert.equal(grant.transaction.actions[0].transfer!.deposit,5_000_000_000_000_000_000_000n);
  assert.equal(f.broadcasts.at(-1),request.signed_tx);
  await signedPlayerAction(f.c,request);assert.equal(f.keys().length,1);
});
test('owned Mana meter uses the actual 0.02-NEAR starter grant',async()=>{
  const f=fixture(),state=await snapshot(f.c);assert.equal(state.environment.starter_native,'20000000000000000000000');assert.equal(state.environment.player_owned,true);assert.deepEqual(f.keys(),[]);
});
test('hosted NPC retries reuse the same judgment; conversation choices require no inference',async()=>{
  const f=fixture(),message={request_id:randomUUID(),message:'How do I find herbs?'};f.hint();
  const greet=await npc(f.c,{request_id:randomUUID(),choice:'greet'},'fixture-provider');assert.equal(greet.thread.turn,1);assert.equal(f.models(),0);
  const hint=await npc(f.c,{request_id:randomUUID(),choice:'hint'},'fixture-provider');assert.equal(hint.thread.turn,2);
  const first=await npc(f.c,message,'fixture-provider');assert.equal(first.thread.turn,3);
  const again=await npc({...f.c},message,'fixture-provider');assert.deepEqual(again,first);
  assert.equal(first.chat_available,false);
  assert.equal(f.models(),1);
});
test('a hosted NPC offer reserves funds once across duplicate requests and a cold controller',async()=>{
  const f=fixture(),body={request_id:randomUUID(),choice:'work'};
  const first=await npc(f.c,body,'');assert.equal(first.orders.order?.token_id,'sunleaf');assert.equal(first.orders.order?.amount,'3');assert.equal(f.offers(),1);
  assert.deepEqual(await npc({...f.c},body,''),first);assert.equal(f.offers(),1);assert.deepEqual(f.keys(),['mira']);assert.equal(f.models(),0);
});
test('wallet linking requires a FullAccess NEP-413 proof; an exact lost-response replay cannot allocate another shop',async(t)=>{
  const f=fixture(),origin='https://game.example';
  const c=await walletChallenge(f.c,{request_id:randomUUID(),world_id:null},origin);
  const str=(v:string)=>{const b=Buffer.from(v),l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b]);};
  const tag=Buffer.alloc(4);tag.writeUInt32LE(2**31+413);
  const signed=createHash('sha256').update(Buffer.concat([tag,str(c.message),Buffer.from(c.nonce,'base64'),str(origin),Buffer.from([1]),str(origin+'/')])).digest();
  const body={challenge_id:c.id,proof:{account_id:f.c.player,public_key:f.playerKey.getPublicKey().toString(),signature:Buffer.from(f.playerKey.sign(signed).signature).toString('base64')}};
  await assert.rejects(linkWallet(f.c,body,origin),/full-access key/);
  f.proof();assert.equal((await linkWallet(f.c,body,origin)).world_id,f.c.world.id);
  t.mock.timers.enable({apis:['Date'],now:Date.now()+120_000});
  assert.equal((await linkWallet({...f.c},body,origin)).world_id,f.c.world.id);assert.deepEqual(f.keys(),[]);
  await assert.rejects(linkWallet(f.c,body,'https://attacker.example'),/another session/);
});
test('only an unknown implicit account matching the proven Ed25519 key may be linked before starter funding',async()=>{
  for(const [cause,matching,allowed] of [['UNKNOWN_ACCOUNT',true,true],['UNKNOWN_ACCOUNT',false,false],['UNKNOWN_ACCESS_KEY',true,false],['HTTP_ERROR',true,false],['NETWORK_ERROR',true,false]] as const){
    const f=fixture(),origin='https://game.example',challenge=await walletChallenge(f.c,{request_id:randomUUID(),world_id:null},origin);
    const public_key=f.playerKey.getPublicKey().toString(),account_id=matching?implicitAccount(public_key):'1'.repeat(64);
    const hash=nep413Digest({...challenge,nonce:Buffer.from(challenge.nonce,'base64')});
    const body={challenge_id:challenge.id,proof:{account_id,public_key,signature:Buffer.from(f.playerKey.sign(hash).signature).toString('base64')}};
    const original=f.c.fetcher;
    f.c.fetcher=async(input,init)=>{
      if(new URL(String(input)).hostname==='test.rpc.fastnear.com'){
        if(cause==='NETWORK_ERROR')throw Error('Simulated offline lookup');
        return Response.json({error:{cause:{name:cause}}});
      }
      return original(input,init);
    };
    if(allowed)assert.equal((await linkWallet(f.c,body,origin)).world_id,f.c.world.id);
    else await assert.rejects(linkWallet(f.c,body,origin));
    assert.deepEqual(f.keys(),[]);assert.deepEqual(f.broadcasts,[]);
  }
});
