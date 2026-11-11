import {Buffer} from 'buffer';
import {PublicKey,KeyType} from '@near-js/crypto';
import {actionCreators,createTransaction,encodeTransaction,Signature,SignedTransaction,type Action} from '@near-js/transactions';
import {baseDecode,baseEncode} from '@near-js/utils';
import {challengePayload} from '../../backend/player-identity.ts';
import {gameplayMethods,deviceKey,stored} from './player-device.ts';
import type {PlayerSigner} from './privy.ts';
import type {GameConnection} from './account';
import type {GameState} from './types';

type Challenge={id:string;message:string;nonce:string;recipient:string;callbackUrl:string;expires_at:string};
type Binding={challenge:Challenge;proof:{account_id:string;public_key:string;signature:string}};
type Access={account_id:string;contract_id:string;session:null|{public_key:string;expires_at_ms:number}};
type SavedTx={signed:string;hash:string;sent?:boolean;failed?:boolean;confirmed?:boolean};
type Approval={expires:number;key?:SavedTx;authorization?:SavedTx;complete?:boolean};
const post=(value:object):RequestInit=>({method:'POST',body:JSON.stringify(value)});
const bytes=(value:object)=>new TextEncoder().encode(JSON.stringify(value));
const pending=()=>Error('Game access is awaiting confirmation. Open this saved game again to check the same request.');
export const sha256=async(bytes:Uint8Array)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)));

export async function bindSocialGame(request:GameConnection,owner:string,requestId:string,world:string|null,signer:PlayerSigner,guard:()=>void){
  const slot='social-bind:'+owner+':'+requestId;
  let saved=await stored<Binding>(slot);guard();
  if(!saved){
    const challenge=await request<Challenge>('/wallet-challenge',post({request_id:requestId,world_id:world}));guard();
    const nonce=Buffer.from(challenge.nonce,'base64');
    if(challenge.recipient!==location.origin||challenge.callbackUrl!==location.origin+'/'||!Number.isFinite(Date.parse(challenge.expires_at))||Date.parse(challenge.expires_at)<=Date.now()||nonce.length!==32||nonce.toString('base64')!==challenge.nonce)throw Object.assign(Error('Game access confirmation expired. Start again from Saved games.'),{status:400});
    const digest=await sha256(challengePayload({...challenge,nonce:new Uint8Array(nonce)}));guard();
    const signature=await signer.sign(digest);guard();
    saved={challenge,proof:{account_id:signer.account,public_key:signer.publicKey,signature:Buffer.from(signature).toString('base64')}};
    await stored(slot,saved);guard();
  }
  if(saved.proof.account_id!==signer.account||saved.proof.public_key!==signer.publicKey)throw Error('Use the Google account that created this game.');
  return request<{world_id:string}>('/wallet-link',post({challenge_id:saved.challenge.id,proof:saved.proof}));
}

async function rpc(method:string,params:object):Promise<any>{
  const response=await fetch('https://test.rpc.fastnear.com',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'access',method,params}),redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw pending();
  const body=await response.json();
  if(body.error)throw Object.assign(pending(),{causeName:body.error.cause?.name});
  if(!body.result)throw pending();return body.result;
}

async function signedSetup(signer:PlayerSigner,receiver:string,actions:Action[],guard:()=>void):Promise<SavedTx>{
  guard();const access=await rpc('query',{request_type:'view_access_key',finality:'final',account_id:signer.account,public_key:signer.publicKey});guard();
  if(access.permission!=='FullAccess'||!Number.isSafeInteger(access.nonce))throw Error('Saved game access could not be verified.');
  const tx=createTransaction(signer.account,PublicKey.fromString(signer.publicKey),receiver,BigInt(access.nonce)+1n,actions,baseDecode(access.block_hash));
  const digest=await sha256(encodeTransaction(tx));guard();const signature=await signer.sign(digest);guard();
  if(!PublicKey.fromString(signer.publicKey).verify(digest,signature))throw Error('Saved game approval could not be verified.');
  return {signed:Buffer.from(new SignedTransaction({transaction:tx,signature:new Signature({keyType:KeyType.ED25519,data:signature})}).encode()).toString('base64'),hash:baseEncode(digest)};
}

async function confirm(tx:SavedTx,signer:PlayerSigner,persist:()=>Promise<void>,guard:()=>void){
  if(tx.failed)throw Error('Game access was declined. Try opening this saved game again.');
  if(tx.confirmed)return;
  guard();let receipt;
  if(tx.sent){
    try{receipt=await rpc('tx',{tx_hash:tx.hash,sender_account_id:signer.account,wait_until:'FINAL'});}
    catch(error){if((error as {causeName?:string}).causeName!=='UNKNOWN_TRANSACTION')throw error;}
    guard();
  }
  if(!receipt){tx.sent=true;await persist();guard();receipt=await rpc('send_tx',{signed_tx_base64:tx.signed,wait_until:'FINAL'});guard();}
  if(receipt.transaction?.hash!==tx.hash||receipt.transaction?.signer_id!==signer.account||receipt.final_execution_status!=='FINAL')throw pending();
  if(!receipt.status||!Array.isArray(receipt.receipts_outcome))throw pending();
  const statuses=[receipt.status,...receipt.receipts_outcome.map((r:any)=>r.outcome?.status)];
  tx.failed=statuses.some(s=>s?.Failure);
  if(!tx.failed&&statuses.some(s=>!s||!('SuccessValue' in s||'SuccessReceiptId' in s)))throw pending();
  tx.confirmed=!tx.failed;await persist();guard();
  if(tx.failed)throw Error('Game access was declined. Try opening this saved game again.');
}

export async function enableSocialDevice(request:GameConnection,world:string,signer:PlayerSigner,guard:()=>void){
  if(!navigator.locks)throw Error('This browser cannot protect saved-game access. Please use a current browser.');
  return navigator.locks.request('copper-acorn.access:'+signer.account,{signal:AbortSignal.timeout(60_000)},()=>authorizeDevice(request,world,signer,guard));
}

async function authorizeDevice(request:GameConnection,world:string,signer:PlayerSigner,guard:()=>void){
  guard();const access=await request<Access>('/device');guard();
  if(access.account_id!==signer.account)throw Error('Use the Google account that created this game. Your saved game is kept.');
  const state=await request<GameState>('/state');guard();
  if(state.pending_operation)throw Error('An earlier game action is awaiting confirmation. Refresh the ledger before restoring access.');
  const slot='owned:'+world,approvalSlot=slot+':approval';
  let device=await stored<Awaited<ReturnType<typeof deviceKey>>>(slot);guard();
  if(!device){device=await deviceKey();guard();await stored(slot,device);guard();}
  let approval=await stored<Approval>(approvalSlot);guard();
  if(!approval||approval.complete||approval.key?.failed||approval.authorization?.failed){
    approval={expires:Date.now()+86_000_000};await stored(approvalSlot,approval);guard();
  }
  const persist=async()=>{await stored(approvalSlot,approval);};
  if(!approval.key){
    const old=await request<{missing?:boolean;permission?:{FunctionCall?:{receiver_id:string;method_names:string[]}}}>('/rpc',post({method:'query',params:{request_type:'view_access_key',finality:'final',account_id:access.account_id,public_key:device.publicKey}}));guard();
    const permission=old.permission?.FunctionCall;
    if(!old.missing&&(!permission||permission.receiver_id!==access.contract_id||permission.method_names.length!==gameplayMethods.length||!gameplayMethods.every(m=>permission.method_names.includes(m))))throw Error('This browser’s game access could not be confirmed.');
    const actions:Action[]=old.missing?[]:[actionCreators.deleteKey(PublicKey.fromString(device.publicKey))];
    if(access.session&&access.session.public_key!==device.publicKey){
      const previous=await request<{missing?:boolean;permission?:{FunctionCall?:{receiver_id:string;method_names:string[]}}}>('/rpc',post({method:'query',params:{request_type:'view_access_key',finality:'final',account_id:access.account_id,public_key:access.session.public_key}}));guard();
      const permission=previous.permission?.FunctionCall;
      if(permission?.receiver_id===access.contract_id&&permission.method_names.length===gameplayMethods.length&&gameplayMethods.every(m=>permission.method_names.includes(m)))actions.push(actionCreators.deleteKey(PublicKey.fromString(access.session.public_key)));
    }
    actions.push(actionCreators.addKey(PublicKey.fromString(device.publicKey),actionCreators.functionCallAccessKey(access.contract_id,gameplayMethods,100_000_000_000_000_000_000_000n)));
    approval.key=await signedSetup(signer,signer.account,actions,guard);await persist();guard();
  }
  await confirm(approval.key,signer,persist,guard);
  if(!approval.authorization){
    approval.authorization=await signedSetup(signer,access.contract_id,[actionCreators.functionCall('authorize_game_session',bytes({public_key:device.publicKey,expires_at_ms:approval.expires,actions:500,copper_limit:'100'}),20_000_000_000_000n,1n)],guard);
    await persist();guard();
  }
  await confirm(approval.authorization,signer,persist,guard);
  const confirmed=await request<Access>('/device');guard();
  if(confirmed.account_id!==signer.account||confirmed.contract_id!==access.contract_id||confirmed.session?.public_key!==device.publicKey||confirmed.session.expires_at_ms<=Date.now()+10_000)throw pending();
  approval.complete=true;await persist();guard();
}
