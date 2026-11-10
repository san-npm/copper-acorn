import {Buffer} from 'buffer';
import {PublicKey,KeyType} from '@near-js/crypto';
import {actionCreators,createTransaction,encodeTransaction,Signature,SignedTransaction} from '@near-js/transactions';
import {baseDecode} from '@near-js/utils';
import {stored} from './player-device';
import {playerCall} from '../../backend/player-action';
import type {Action,GameState,Operation} from './types';
import type {GameConnection} from './account';

type Device={pair:CryptoKeyPair;publicKey:string};
type Access={account_id:string;contract_id:string;session:null|{public_key:string;expires_at_ms:number;actions_left:number;copper_left:string}};
type Saved={body:string;signed_tx:string};
const bytes=(v:unknown)=>new TextEncoder().encode(JSON.stringify(v));
const rejected=(message:string)=>Object.assign(Error(message),{status:400});
export function ownedDevice(request:GameConnection,world:()=>string|null){
  const slot=(id:string)=>'owned:'+id;
  async function local(){
    const id=world();if(!id)throw Error('Select a saved game first.');
    return stored<Device>(slot(id));
  }
  async function access(){return request<Access>('/device');}
  async function ready(){
    const [d,a]=await Promise.all([local(),access()]);
    return !!d&&a.session?.public_key===d.publicKey&&a.session.expires_at_ms>Date.now()+10_000&&a.session.actions_left>0&&BigInt(a.session.copper_left)>0n;
  }
  async function action(id:string,action:Action,state:GameState):Promise<Operation>{
    const savedSlot=slot(state.environment.world_id)+':'+id,body=JSON.stringify(action);
    let saved=await stored<Saved>(savedSlot);
    if(saved&&saved.body!==body)throw Error('This request ID belongs to another action.');
    if(!saved){
      const d=await local();if(!d)throw rejected('Access from this browser is unavailable. Open Saved games.');
      const a=await access();
      if(a.session?.public_key!==d.publicKey||a.session.expires_at_ms<=Date.now()||a.session.actions_left<1)throw rejected('Your play session needs to be renewed. Open Saved games.');
      const nonce=await request<{nonce:number;block_hash:string}>('/rpc',{method:'POST',body:JSON.stringify({method:'query',params:{request_type:'view_access_key',finality:'final',account_id:a.account_id,public_key:d.publicKey}})});
      if(!Number.isSafeInteger(nonce.nonce))throw Error('Your next action could not be prepared.');
      const p=playerCall(action,state),tx=createTransaction(a.account_id,PublicKey.fromString(d.publicKey),a.contract_id,BigInt(nonce.nonce)+1n,[actionCreators.functionCall(p.method,bytes(p.args),20_000_000_000_000n,0n)],baseDecode(nonce.block_hash));
      const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(encodeTransaction(tx))));
      const signature=new Signature({keyType:KeyType.ED25519,data:new Uint8Array(await crypto.subtle.sign('Ed25519',d.pair.privateKey,new Uint8Array(digest)))});
      saved={body,signed_tx:Buffer.from(new SignedTransaction({transaction:tx,signature}).encode()).toString('base64')};
      await stored(savedSlot,saved);
    }
    return request<Operation>('/action',{method:'POST',body:JSON.stringify({world_id:state.environment.world_id,request_id:id,action,signed_tx:saved.signed_tx})});
  }
  return {ready,action};
}
