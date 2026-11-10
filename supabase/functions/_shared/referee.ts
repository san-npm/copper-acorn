import {KeyPair} from '@near-js/crypto';
import {baseEncode} from '@near-js/utils';
import type {SupabaseClient} from '@supabase/supabase-js';
import {account,access,view,rpc,sign,actions,NEAR,TGAS,digest} from '../game-api/near.ts';
import {settlePending,type Referee,type ResultRecord} from '../../../backend/arena-settlement.ts';
import type {Store} from '../../../backend/arena-engine.ts';

async function call(db:SupabaseClient,name:string,args={}){const {data,error}=await db.rpc(name,args);if(error)throw Error('Referee journal could not be confirmed.');return data;}
async function runtime(db:SupabaseClient){const {data,error}=await db.from('game_arena_runtime').select('account_id,contract_id,ready_at,signed_tx,tx_hash').eq('singleton',true).single();if(error||!data)throw Error('Referee setup unavailable.');return data;}
async function signingKey(db:SupabaseClient){return KeyPair.fromString(await call(db,'arena_signing_key'));}
export async function provisionReferee(db:SupabaseClient,wasm:Uint8Array,fetcher:typeof fetch=fetch){
  await call(db,'ensure_arena_runtime',{p_account:'ar-'+crypto.randomUUID().replaceAll('-','')+'.testnet',p_secret:KeyPair.fromRandom('ed25519').toString()});
  let r=await runtime(db);if(r.ready_at)return true;
  const key=await signingKey(db);
  if(!await account(r.account_id,fetcher)){
    if(await call(db,'claim_arena_faucet')){
      let status=null;try{const response=await fetcher('https://helper.nearprotocol.com/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:r.account_id,newAccountPublicKey:key.getPublicKey().toString()}),signal:AbortSignal.timeout(10_000),redirect:'error'});status=response.status;await response.body?.cancel();}catch{}
      const write=await db.from('game_arena_runtime').update({faucet_http_status:status}).eq('singleton',true);if(write.error)throw Error('Referee funding result could not be saved.');
    }
    return false;
  }
  await access(r.account_id,key,fetcher);
  if(!await account(r.contract_id,fetcher)){
    if(!r.signed_tx){const tx=await sign(r.account_id,r.contract_id,key,[actions.createAccount(),actions.transfer(5n*NEAR/2n),actions.deployContract(wasm),actions.functionCall('new',{referee:r.account_id},50n*TGAS,0n)],fetcher);r=await call(db,'save_arena_setup',{p_signed:tx.signed_tx,p_hash:tx.tx_hash});}
    await rpc('send_tx',{signed_tx_base64:r.signed_tx,wait_until:'NONE'},fetcher).catch(()=>null);
    const result=await rpc('tx',{tx_hash:r.tx_hash,sender_account_id:r.account_id,wait_until:'FINAL'},fetcher);
    if(result.transaction?.hash!==r.tx_hash||result.final_execution_status!=='FINAL'||result.status?.Failure||result.receipts_outcome?.some((x:any)=>x.outcome?.status?.Failure))throw Error('Referee setup is awaiting confirmation.');
  }
  // The contract has no account access key and no upgrade method.
  if((await account(r.contract_id,fetcher))?.code_hash!==baseEncode(await digest(wasm)))throw Error('The referee code does not match this release.');
  await view(r.contract_id,'result',{match_id:'00000000-0000-4000-8000-000000000000'},fetcher);
  const write=await db.from('game_arena_runtime').update({ready_at:new Date().toISOString()}).eq('singleton',true);if(write.error)throw Error('Referee readiness could not be saved.');return true;
}
export async function hostedReferee(db:SupabaseClient,fetcher:typeof fetch=fetch):Promise<Referee>{
  const r=await runtime(db);if(!r.ready_at)throw Error('The NEAR referee is still being prepared.');
  return {
    async result(match_id){const prior=await view(r.contract_id,'result',{match_id},fetcher);if(prior)await call(db,'confirm_duel_report',{p_match:match_id,p_report:prior});return prior;},
    progress:(account_id,save_id)=>view(r.contract_id,'progress',{account_id,save_id:save_id||null},fetcher),
    async settle(report:ResultRecord){
      let record=await call(db,'claim_duel_report',{p_match:report.match_id,p_report:report});
      if(!record.signed_tx){
        if(!record.claimed)throw Error('Another result is being confirmed.');
        const tx=await sign(r.account_id,r.contract_id,await signingKey(db),[actions.functionCall('settle_duel',{result:report},30n*TGAS,0n)],fetcher);
        if(!await call(db,'save_duel_transaction',{p_match:report.match_id,p_claim:record.claim_id,p_signed:tx.signed_tx,p_hash:tx.tx_hash}))throw Error('Result submission lease expired.');
        record={...record,...tx};
      }
      await rpc('send_tx',{signed_tx_base64:record.signed_tx,wait_until:'NONE'},fetcher).catch(()=>null);
      const result=await rpc('tx',{tx_hash:record.tx_hash,sender_account_id:r.account_id,wait_until:'FINAL'},fetcher);
      if(result.transaction?.hash!==record.tx_hash||result.final_execution_status!=='FINAL'||result.status?.Failure||result.receipts_outcome?.some((x:any)=>x.outcome?.status?.Failure))throw Error('NEAR result confirmation is pending.');
      return {hash:record.tx_hash};
    },
  };
}
export async function confirmHostedResults(db:SupabaseClient,fetcher:typeof fetch=fetch){
  const loaded=await db.from('game_arena_state').select('state').eq('singleton',true).single();if(loaded.error)throw Error('Arena save unavailable.');
  const settled=await settlePending(loaded.data.state as Store,await hostedReferee(db,fetcher));
  for(let attempt=0;attempt<4;attempt++){
    const current=await db.from('game_arena_state').select('state,revision').eq('singleton',true).single();if(current.error)throw Error('Arena save unavailable.');
    const next=current.data.state as Store;let changed=false;
    for(const [id,receipt] of Object.entries(settled.settlements||{})){
      if(receipt.status!=='confirmed'||next.settlements?.[id]?.status!=='pending')continue;
      next.settlements[id]=receipt;changed=true;
      for(const p of next.matches[id].players){const confirmed=settled.profiles[p.id];Object.assign(next.profiles[p.id],{xp:confirmed.xp,wins:confirmed.wins,losses:confirmed.losses});}
    }
    if(!changed)return;
    const write=await db.from('game_arena_state').update({state:next,revision:current.data.revision+1}).eq('singleton',true).eq('revision',current.data.revision).select('revision');
    if(write.error)throw Error('Arena result save unavailable.');
    if(write.data?.length){
      const ids=Object.entries(settled.settlements||{}).filter(([,r])=>r.status==='confirmed').map(([id])=>id);
      if(ids.length){const updated=await db.from('game_duel_outbox').update({status:'confirmed'}).in('match_id',ids);if(updated.error)throw Error('Referee journal completion is pending.');}return;
    }
  }
  throw Error('Arena result save is busy.');
}
