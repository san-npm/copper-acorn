import {KeyType, PublicKey} from '@near-js/crypto';
import {actionCreators, createTransaction, encodeTransaction, Signature, SignedTransaction, type Action as NearAction} from '@near-js/transactions';
import {baseDecode, baseEncode} from '@near-js/utils';
import type {Action, GameState, Operation} from './types';
import {playerCall,gameplayMethods} from '../../backend/player-action.ts';

export {gameplayMethods};
const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v));
const fn = (method: string, args: object, deposit = 0n) => actionCreators.functionCall(method, bytes(args), 20_000_000_000_000n, deposit);
const b64 = (v: Uint8Array) => btoa(String.fromCharCode(...v));
type Device = {root: CryptoKeyPair; session: CryptoKeyPair; rootPublic: string; sessionPublic: string; world: string; setup: string; account: string};
type SavedTx = {body: string; signed: string; hash: string;slot:string;sent?:boolean;outcome?:Operation};
let database:Promise<IDBDatabase>|undefined;
function openDatabase(){return database??=new Promise<IDBDatabase>((resolve,reject) => {
  const request = indexedDB.open('copper-acorn.player-device',1);
  request.onupgradeneeded = () => request.result.createObjectStore('keys');
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(Error('Device storage is unavailable.'));
});}
export async function stored<T>(key: string, value?: T): Promise<T|undefined> {
  const db = await openDatabase();
  return new Promise((resolve,reject) => {
    const tx = db.transaction('keys',value === undefined ? 'readonly' : 'readwrite');
    const op = value === undefined ? tx.objectStore('keys').get(key) : tx.objectStore('keys').put(value,key);
    tx.oncomplete = () => resolve(value === undefined ? op.result : value);
    tx.onerror = () => reject(Error('Device storage could not be confirmed. No new transaction was sent.'));
    tx.onabort = tx.onerror;
  });
}
export async function deviceKey() {
  const pair = await crypto.subtle.generateKey('Ed25519',false,['sign','verify']) as CryptoKeyPair;
  const publicKey = 'ed25519:'+baseEncode(new Uint8Array(await crypto.subtle.exportKey('raw',pair.publicKey)));
  return {pair,publicKey};
}

// shortcut: these non-exportable Sandbox keys have no recovery; use a player wallet before public rollout.
export function localPlayerDevice(base: string) {
  const post = async (path: string, body: object) => {
    const response = await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60_000),redirect:'error'});
    const data = await response.json();
    if(!response.ok)throw Object.assign(Error(data.error||'Player-owned preview is unavailable.'),{status:response.status});
    return data;
  };
  const rpc = async (world: string, method: string, params: object) => {
    const response = await post('/api/owned/rpc',{world_id:world,method,params});
    if(response.error)throw Object.assign(Error('The chain has not confirmed this request.'),{invalid:!!response.error.data?.TxExecutionError?.InvalidTxError});
    return response.result;
  };
  const view = async (world: string, method: string, args = {}) => {
    const value = await rpc(world,'query',{request_type:'call_function',finality:'final',account_id:'game.owner.test.near',method_name:method,args_base64:b64(bytes(args))});
    return JSON.parse(new TextDecoder().decode(new Uint8Array(value.result)));
  };
  async function sign(world: string, privateKey: CryptoKey, publicKey: string, receiver: string, actions: NearAction[], body: string, id: string) {
    const saved = await stored<SavedTx>(world+':'+id);
    if(saved){if(saved.body!==body)throw Error('Request ID already belongs to another action.');return saved;}
    const device=await stored<Device>(world);if(!device)throw Error('Player device is unavailable.');
    const access = await rpc(world,'query',{request_type:'view_access_key',finality:'final',account_id:device.account,public_key:publicKey});
    if(!Number.isSafeInteger(access.nonce))throw Error('Invalid device nonce.');
    const tx = createTransaction(device.account,PublicKey.fromString(publicKey),receiver,BigInt(access.nonce)+1n,actions,baseDecode(access.block_hash));
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(encodeTransaction(tx))));
    const signature = new Signature({keyType:KeyType.ED25519,data:new Uint8Array(await crypto.subtle.sign('Ed25519',privateKey,new Uint8Array(hash)))});
    const signed = new SignedTransaction({transaction:tx,signature});
    return (await stored(world+':'+id,{body,signed:b64(signed.encode()),hash:baseEncode(hash),slot:world+':'+id}))!;
  }
  async function confirm(world: string, tx: SavedTx): Promise<Operation> {
    if(tx.outcome)return tx.outcome;
    const firstAttempt=!tx.sent;
    try {
      let outcome;
      if(tx.sent)try{outcome=await rpc(world,'tx',{tx_hash:tx.hash,sender_account_id:(await stored<Device>(world))?.account,wait_until:'FINAL'});}catch{}
      if(!outcome){tx.sent=true;await stored(tx.slot,tx);outcome = await rpc(world,'send_tx',{signed_tx_base64:tx.signed,wait_until:'FINAL'});}
      if(outcome.transaction?.hash!==tx.hash||outcome.transaction?.signer_id!==(await stored<Device>(world))?.account||outcome.final_execution_status!=='FINAL')return {status:'unconfirmed',result:{hash:tx.hash},error:'The same signed request is saved on this device. Refresh to check it.'};
      const failed = outcome.status?.Failure||outcome.receipts_outcome?.some((r:any)=>r.outcome?.status?.Failure);
      tx.outcome={status:failed?'failed':'confirmed',result:{hash:tx.hash},error:failed?'The contract rejected this action. Your confirmed inventory was preserved.':null};
      await stored(tx.slot,tx);return tx.outcome;
    } catch (error) {
      if(firstAttempt&&(error as {invalid?:boolean}).invalid){tx.outcome={status:'failed',result:{hash:tx.hash},error:'The chain rejected this transaction before execution. Check your device access and gas balance.'};await stored(tx.slot,tx);return tx.outcome;}
      return {status:'unconfirmed',result:{hash:tx.hash},error:'The same signed request is saved on this device. Refresh to check it.'}; }
  }
  async function create(requestId: string = crypto.randomUUID(),progress?:(text:string)=>void) {
    progress?.('Preparing your shop…');
    let d = await stored<Device>('setup:'+requestId);
    if(!d){const root = await deviceKey(),session = await deviceKey();d={root:root.pair,session:session.pair,rootPublic:root.publicKey,sessionPublic:session.publicKey,world:'',setup:requestId,account:''};await stored('setup:'+requestId,d);}
    if(!d.world){const result = await post('/api/owned/new-game',{request_id:requestId,public_key:d.rootPublic});d.world=result.world_id;d.account=result.player_id;await stored('setup:'+requestId,d);await stored(d.world,d);}
    progress?.('Saving your game access on this device…');
    const added = await sign(d.world,d.root.privateKey,d.rootPublic,d.account,[actionCreators.addKey(PublicKey.fromString(d.sessionPublic),actionCreators.functionCallAccessKey('game.owner.test.near',gameplayMethods,100_000_000_000_000_000_000_000n))],'add-device','setup-key');
    if((await confirm(d.world,added)).status!=='confirmed')throw Error('Device key setup is pending. Reopen this same setup.');
    progress?.('Confirming your shop…');
    let expires = await stored<number>(d.world+':expires');
    if(!expires){expires=Date.now()+86_000_000;await stored(d.world+':expires',expires);}
    const auth = await sign(d.world,d.root.privateKey,d.rootPublic,'game.owner.test.near',[fn('authorize_game_session',{public_key:d.sessionPublic,expires_at_ms:expires,actions:500,copper_limit:'100'},1n)],'authorize-device','setup-authorization');
    if((await confirm(d.world,auth)).status!=='confirmed')throw Error('Device authorization is pending. Reopen this same setup.');
    return d.world;
  }
  function plan(action:Action,state:GameState){const p=playerCall(action,state);return fn(p.method,p.args);}
  return {create,view,
    async action(world: string, id: string, action: Action, state: GameState) {
      const device = await stored<Device>(world);if(!device)throw Error('This browser does not have this shop’s device key.');
      const tx = await sign(world,device.session.privateKey,device.sessionPublic,'game.owner.test.near',[plan(action,state)],JSON.stringify(action),id);
      return confirm(world,tx);
    },
    async operation(world: string, id: string) {const tx=await stored<SavedTx>(world+':'+id);if(!tx)throw Error('Signed request is not available on this device.');return confirm(world,tx);},
    async revoke(world: string) {
      const d=await stored<Device>(world);if(!d)throw Error('This device has no local test wallet.');
      const tx=await sign(world,d.root.privateKey,d.rootPublic,'game.owner.test.near',[fn('revoke_game_session',{},1n)],'revoke',crypto.randomUUID());
      return confirm(world,tx);
    },
  };
}
