import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {KeyPair} from '@near-js/crypto';
import {baseEncode} from '@near-js/utils';
import {npc} from '../supabase/functions/game-api/npc.ts';
import {namesFor,type Context} from '../supabase/functions/game-api/game.ts';
import type {Orders,Thread} from './npc.ts';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fixture(options:{lostFinalWrite?:boolean;legacyHash?:boolean;lostJudgment?:boolean}={}){
  const c={owner:randomUUID(),session:randomUUID(),world:{id:randomUUID(),status:'ready',contract_id:'items.ao-fictional.testnet',is_active:true},player:'fictional.testnet',namespace:'ao-fictional.testnet'} as Context;
  const key=KeyPair.fromRandom('ed25519'),operations=new Map<string,any>(),turns=new Map<string,any>(),judgments=new Map<string,any>(),broadcasts:string[]=[];
  let thread:Thread={turn:0,messages:[]},orders:Orders={completed:0,last_offer_day:null,order:null},models=0,offers=0,failedFinal=false,claims=0;
  let afterClaim:(()=>void)|undefined;
  const reads={orders:0,thread:0};
  const state={player:{account_id:c.player,next_action:0,balances:{copper:'40',sunleaf:'0'}},world:{day:0,native_pool:'200000000000000000000000',refill_amount:'10000000000000000000000'},craft_fee:'1',catalog:[{token_id:'sunleaf',name:'Sunleaf',gather_cap:'6',gathered_today:'0',recipe:null,base_value:'3'}],merchants:[{name:'Mira',account:{account_id:namesFor(c).mira,balances:{copper:'100',sunleaf:'6'}}}]};
  const fetcher:typeof fetch=async(input,init)=>{
    const request=new Request(input,init),url=new URL(request.url),body=request.method==='POST'?await request.json():null;
    if(url.hostname==='api.typesafe.ai'){
      models++;if(options.lostJudgment)throw Error('Fictional lost model response');
      return Response.json({model:'fictional-jev',answers:{wants_work:{type:'noul',noul:.99},wants_hint:{type:'noul',noul:.01},prefers_potions:{type:'noul',noul:.01}},usage:{input_tokens:100,output_tokens:20}});
    }
    if(url.hostname==='test.rpc.fastnear.com'){
      if(body.method==='send_tx'){
        assert.ok([...operations.values()].some(o=>o.signed_tx===body.params.signed_tx_base64),'Persist the exact offer before broadcasting');
        broadcasts.push(body.params.signed_tx_base64);return Response.json({result:{final_execution_status:'NONE'}});
      }
      if(body.method==='tx'){
        const op=[...operations.values()].find(o=>o.tx_hash===body.params.tx_hash);assert.ok(op);
        if(op.action.kind==='npc_offer'&&!orders.order){offers++;orders={completed:0,last_offer_day:0,order:{id:1,token_id:op.action.token_id,amount:op.action.amount,reward:String(Number(op.action.amount)*3),status:'offered',expires_day:2}};}
        return Response.json({result:{transaction:{hash:op.tx_hash,signer_id:op.signer_id},final_execution_status:'FINAL',status:{SuccessValue:''},transaction_outcome:{outcome:{gas_burnt:100}},receipts_outcome:[]}});
      }
      if(body.method==='gas_price')return Response.json({result:{gas_price:'100000000'}});
      if(body.params.request_type==='view_account')return Response.json({result:{amount:'1000000000000000000000000',storage_usage:0}});
      if(body.params.request_type==='view_access_key')return Response.json({result:{permission:'FullAccess',nonce:0,block_height:500,block_hash:baseEncode(new Uint8Array(32))}});
      assert.ok(['mira_orders_view','game_view'].includes(body.params.method_name));
      if(body.params.method_name==='mira_orders_view')reads.orders++;
      return Response.json({result:{result:[...Buffer.from(JSON.stringify(body.params.method_name==='mira_orders_view'?orders:state))]}});
    }
    assert.equal(url.hostname,'example.supabase.co','All network calls must stay in the fictional fetch stub');
    const name=url.pathname.split('/').at(-1)!;
    if(url.pathname.includes('/rpc/')){
      if(name==='begin_npc_turn'){
        const prior=turns.get(body.p_request);
        if(prior){
          if(prior.input_hash!==body.p_hash)return Response.json({code:'23505'},{status:400});
          if(prior.status!=='uncertain')return Response.json({...prior,claimed:false});
          Object.assign(prior,{status:'working',claim_id:randomUUID()});return Response.json({...prior,claimed:true});
        }
        const fresh={input_hash:body.p_hash,status:'working',claim_id:randomUUID()};turns.set(body.p_request,fresh);claims++;afterClaim?.();afterClaim=undefined;
        return Response.json({...fresh,claimed:true});
      }
      if(name==='finish_npc_turn'){
        if(!body.p_error&&options.lostFinalWrite&&!failedFinal){failedFinal=true;throw Error('Fictional lost final database write');}
        const turn=turns.get(body.p_request);assert.equal(turn.claim_id,body.p_claim);
        Object.assign(turn,{status:body.p_error?'uncertain':'done',result:body.p_result});
        if(!body.p_error)thread=structuredClone(body.p_thread);return Response.json(true);
      }
      if(name==='reserve_npc_judgment'){
        const prior=judgments.get(body.p_request);
        if(prior){
          if(prior.input_hash!==body.p_hash)return Response.json({code:'23505'},{status:400});
          return Response.json({...prior,claimed:false});
        }
        assert.equal(judgments.size,0,'One fictional free request is authorized');
        const fresh={input_hash:options.legacyHash?hash('earlier mutable question'):body.p_hash,claim_id:randomUUID(),result:null};judgments.set(body.p_request,fresh);
        return Response.json({...fresh,claimed:true});
      }
      if(name==='finish_npc_judgment'){const row=judgments.get(body.p_request);assert.equal(row.claim_id,body.p_claim);row.result=body.p_result;return Response.json(true);}
      if(name==='begin_game_operation'){
        const prior=operations.get(body.p_request);if(prior){assert.deepEqual(prior.action,body.p_action);return Response.json(prior);}
        const op={request_id:body.p_request,claim_id:randomUUID(),action:body.p_action,status:'preparing',result:{},error:null};operations.set(body.p_request,op);return Response.json(op);
      }
      if(name==='game_signing_key'){assert.equal(body.p_role,'mira');return Response.json(key.toString());}
      if(name==='save_game_transaction'){Object.assign(operations.get(body.p_request),{signed_tx:body.p_signed,tx_hash:body.p_hash,signer_id:body.p_signer,status:'pending'});return Response.json(true);}
      if(name==='finish_game_operation'){Object.assign(operations.get(body.p_request),{status:body.p_status,result:body.p_result,error:body.p_error});return Response.json(null);}
      throw Error('Unexpected fixture RPC: '+name);
    }
    if(name==='game_npc_threads'){reads.thread++;return Response.json({thread});}
    if(name==='game_npc_judgments'){assert.equal(url.searchParams.get('world_id'),'eq.'+c.world.id);return Response.json(judgments.get(url.searchParams.get('request_id')!.slice(3))||null);}
    if(name==='game_npc_budget')return Response.json({requests_used:judgments.size,request_limit:1,tokens_used:0,tokens_reserved:judgments.size*3000,token_limit:3000});
    if(name==='game_runtime')return Response.json({served_day:null});
    if(name==='game_operations'){
      const id=url.searchParams.get('request_id')?.slice(3);
      return Response.json(id?operations.get(id)||null:[...operations.values()].find(o=>['preparing','pending'].includes(o.status))||null);
    }
    throw Error('Unexpected fixture table: '+name);
  };
  c.fetcher=fetcher;c.db=createClient('https://example.supabase.co','fictional-public-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:fetcher}});
  return {c,operations,broadcasts,turns,judgments,reads,models:()=>models,offers:()=>offers,thread:()=>thread,claims:()=>claims,afterClaim(fn:()=>void){afterClaim=fn;},replace(saved:Thread,current:Orders){thread=saved;orders=current;}};
}

test('a claimed conversation reads history and the order committed by the previous turn once',async()=>{
  const f=fixture(),saved:Thread={turn:1,messages:[{who:'player',text:'An earlier message.'},{who:'mira',text:'I remember that delivery.'}]};
  const order:Orders={completed:1,last_offer_day:0,order:{id:1,token_id:'sunleaf',amount:'2',reward:'6',status:'accepted',expires_day:2}};
  f.afterClaim(()=>f.replace(saved,order));
  const result=await npc(f.c,{request_id:randomUUID(),choice:'work'},'');
  assert.equal(result.thread.turn,2);assert.deepEqual(result.thread.messages.slice(0,2),saved.messages);
  assert.equal(result.orders.order?.status,'accepted');assert.match(result.thread.messages.at(-1)!.text,/current order is 2 Sunleaf/);
  assert.equal(f.offers(),0);assert.equal(f.models(),0);assert.equal(f.operations.size,0);
  assert.deepEqual(f.reads,{orders:1,thread:1});
});

test('GET reads context once and invalid POST input is rejected before context or a turn is claimed',async()=>{
  const f=fixture();await npc(f.c,null,'');
  assert.deepEqual(f.reads,{orders:1,thread:1});assert.equal(f.claims(),0);
  await assert.rejects(npc(f.c,{request_id:randomUUID(),message:'a'.repeat(401)},'fictional-provider-key'),/short fictional game message/);
  assert.deepEqual(f.reads,{orders:1,thread:1});assert.equal(f.claims(),0);assert.equal(f.models(),0);
});

for(const legacyHash of [false,true])test(`lost final conversation write reuses ${legacyHash?'an earlier-release':'the input-bound'} judgment and one exact funded offer`,async()=>{
  const f=fixture({lostFinalWrite:true,legacyHash}),request={request_id:randomUUID(),message:'Could you give me herb work?'};
  await assert.rejects(npc(f.c,request,'fictional-provider-key'),/durable game record/);
  assert.equal(f.models(),1);assert.equal(f.offers(),1);assert.equal(f.operations.size,1);
  const signed=f.broadcasts[0],result=await npc(f.c,request,'fictional-provider-key');
  assert.equal(result.orders.order?.status,'offered');assert.equal(f.thread().turn,1);
  assert.equal(f.models(),1);assert.equal(f.offers(),1);assert.equal(f.broadcasts.length,1);
  assert.equal([...f.operations.values()][0].signed_tx,signed);
  assert.deepEqual(await npc(f.c,request,'fictional-provider-key'),result);
  await assert.rejects(npc(f.c,{...request,message:'Pay a different order.'},'fictional-provider-key'),/another action/);
  assert.equal(f.models(),1);
});

test('an unknown judgment result keeps its reservation and is never sent again',async()=>{
  const f=fixture({lostJudgment:true}),request={request_id:randomUUID(),message:'Could you give me herb work?'};
  await assert.rejects(npc(f.c,request,'fictional-provider-key'),/timed out/);
  await assert.rejects(npc(f.c,request,'fictional-provider-key'),/will not be sent again/);
  assert.equal(f.models(),1);assert.equal(f.judgments.size,1);assert.equal(f.operations.size,0);assert.equal(f.offers(),0);
});
