import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {verifyWalletProof,challengeMessage,inspectPlayerTransaction} from '../../../backend/wallet-proof.ts';
import {implicitAccount} from '../../../backend/player-identity.ts';
import {gameplayMethods} from '../../../backend/player-action.ts';
import {dbCall,operation,reconcile,publicOperation,key,namesFor,type Context,type Record as OperationRecord} from './game.ts';
import {rpc,view,account,sign,actions,NEAR,RpcError} from './near.ts';
const rejected=(message:string)=>Object.assign(Error(message),{status:400});

export async function walletChallenge(c:Context,body:any,origin:string){
  const nonce=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64');
  const challenge=await dbCall(c,'begin_wallet_challenge',{p_owner:c.owner,p_session:c.session,p_request:body.request_id,p_world:body.world_id||null,p_origin:origin,p_nonce:nonce});
  return {id:challenge.id,nonce:challenge.nonce,message:challengeMessage(challenge),recipient:challenge.origin,callbackUrl:challenge.origin+'/',expires_at:challenge.expires_at};
}
export async function linkWallet(c:Context,body:any,origin:string){
  const {data,error}=await c.db.from('game_wallet_challenges').select('*').eq('id',body.challenge_id).eq('user_id',c.owner).eq('session_id',c.session).single();
  if(error||!data)throw Error('Wallet challenge unavailable.');
  const exactReplay=data.used_at&&data.proof_hash===createHash('sha256').update(JSON.stringify(body.proof)).digest('hex');
  let proofHash;try{proofHash=verifyWalletProof(data,body.proof,c.owner,c.session,origin,exactReplay?Math.min(Date.now(),Date.parse(data.expires_at)-1):Date.now());}catch(e){throw rejected((e as Error).message);}
  try{
    const access=await rpc('query',{request_type:'view_access_key',finality:'final',account_id:body.proof.account_id,public_key:body.proof.public_key},c.fetcher);
    if(access.permission!=='FullAccess')throw rejected('Prove ownership with your wallet’s full-access key.');
  }catch(e){
    // A first transfer creates this exact implicit account and its corresponding full-access key.
    if(!(e instanceof RpcError&&e.causeName==='UNKNOWN_ACCOUNT'&&body.proof.account_id===implicitAccount(body.proof.public_key)))throw e;
  }
  return {world_id:await dbCall(c,'bind_owned_wallet',{p_owner:c.owner,p_session:c.session,p_challenge:body.challenge_id,p_account:body.proof.account_id,p_key:body.proof.public_key,p_proof:proofHash})};
}
export async function ownedWallet(c:Context){
  const {data,error}=await c.db.from('game_owned_wallets').select('account_id,public_key,namespace').eq('world_id',c.world.id).eq('user_id',c.owner).single();
  if(error||!data)throw Error('The player-owned wallet could not be confirmed.');
  return data;
}
export async function device(c:Context){
  return {account_id:c.player,contract_id:namesFor(c).contract,session:await view(namesFor(c).contract,'game_session_view',{},c.fetcher),methods:gameplayMethods};
}
export async function playerQuery(c:Context,body:any){
  if(body.method!=='query'||!body.params||body.params.request_type!=='view_access_key'||body.params.account_id!==c.player||typeof body.params.public_key!=='string'||Object.keys(body.params).sort().join()!=='account_id,finality,public_key,request_type'||body.params.finality!=='final')throw Error('Only your device’s current nonce can be requested.');
  try{return await rpc('query',body.params,c.fetcher);}catch(e){if(e instanceof RpcError&&e.causeName==='UNKNOWN_ACCESS_KEY')return {missing:true};throw e;}
}
export async function supportRefill(c:Context,op:OperationRecord){
  if(!['refill','rescue'].includes(op.action.kind)||op.status!=='pending')return;
  const balance=await account(c.player,c.fetcher),price=await rpc('gas_price',[null],c.fetcher);
  if(!balance||!/^\d+$/.test(price.gas_price)||!Number.isSafeInteger(balance.storage_usage))throw Error('Gas support quote could not be verified.');
  const spendable=BigInt(balance.amount)-BigInt(balance.storage_usage)*10n**19n;
  if(spendable>=20_000_000_000_000n*BigInt(price.gas_price))return;
  const signed=await sign(namesFor(c).owner,c.player,await key(c,'owner'),[actions.transfer(NEAR/200n)],c.fetcher);
  const grant=await dbCall(c,'save_owned_gas_grant',{p_owner:c.owner,p_session:c.session,p_world:c.world.id,p_request:op.request_id,p_signed:signed.signed_tx,p_hash:signed.tx_hash});
  await rpc('send_tx',{signed_tx_base64:grant.signed_tx,wait_until:'NONE'},c.fetcher).catch(()=>null);
  const receipt=await rpc('tx',{tx_hash:grant.tx_hash,sender_account_id:namesFor(c).owner,wait_until:'FINAL'},c.fetcher);
  if(receipt.transaction?.hash!==grant.tx_hash||receipt.final_execution_status!=='FINAL'||receipt.status?.Failure||receipt.receipts_outcome?.some((r:any)=>r.outcome?.status?.Failure))throw Error('Emergency gas support is awaiting confirmation.');
}
export async function signedPlayerAction(c:Context,body:any){
  let op=await operation(c,body.request_id);
  if(op){
    if(!isDeepStrictEqual(op.action,body.action)||op.signed_tx&&op.signed_tx!==body.signed_tx)throw Error('Request ID belongs to another signed action.');
    if(op.status!=='preparing'){await supportRefill(c,op);return publicOperation(await reconcile(c,op));}
  }
  const state=await view(namesFor(c).contract,'game_view',{},c.fetcher);state.environment={contract_id:namesFor(c).contract};
  const session=await view(namesFor(c).contract,'game_session_view',{},c.fetcher);
  if(!session||session.expires_at_ms<=Date.now()||session.actions_left<1)throw rejected('Approve or renew this device in your wallet.');
  let inspected;try{inspected=inspectPlayerTransaction(body.signed_tx,body.action,state,session.public_key);}catch(e){throw rejected((e as Error).message);}
  const permission=await rpc('query',{request_type:'view_access_key',finality:'final',account_id:c.player,public_key:session.public_key},c.fetcher);
  const p=permission.permission?.FunctionCall;
  if(!p||p.receiver_id!==namesFor(c).contract||!Array.isArray(p.method_names)||p.method_names.length!==gameplayMethods.length||!gameplayMethods.every(m=>p.method_names.includes(m))||!Number.isSafeInteger(permission.nonce)||BigInt(permission.nonce)>=inspected.nonce)throw rejected('This device’s wallet permission or nonce is no longer valid.');
  op=await dbCall(c,'begin_game_operation',{p_world:c.world.id,p_owner:c.owner,p_request:body.request_id,p_action:body.action});
  if(op!.status==='preparing')await dbCall(c,'save_game_transaction',{p_world:c.world.id,p_request:body.request_id,p_claim:op!.claim_id,p_signed:body.signed_tx,p_hash:inspected.hash,p_signer:c.player,p_day:null});
  op=(await operation(c,body.request_id))!;
  await supportRefill(c,op);
  return publicOperation(await reconcile(c,op));
}
