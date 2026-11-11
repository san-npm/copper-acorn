import {Buffer} from 'node:buffer';
import {challengePayload} from './player-identity.ts';
import {PublicKey,KeyType} from '@near-js/crypto';
import {decodeSignedTransaction,encodeTransaction,createTransaction} from '@near-js/transactions';
import {baseEncode} from '@near-js/utils';
import {createHash} from 'node:crypto';
import {playerCall} from './player-action.ts';
import type {Action,GameState} from '../web/src/types.ts';

export const testnetAccount=(v:unknown):v is string=>typeof v==='string'&&v.length<=64&&(/^[a-z0-9]+([._-][a-z0-9]+)*\.testnet$/.test(v)||/^[a-f0-9]{64}$/.test(v));
export type WalletChallenge={id:string;nonce:string;origin:string;expires_at:string;session_id:string;user_id:string};
export const challengeMessage=(c:WalletChallenge)=>`Link this NEAR testnet wallet to Copper Acorn.\nChallenge: ${c.id}\nSite: ${c.origin}\nExpires: ${c.expires_at}\nThis message does not transfer assets.`;
export function nep413Digest(p:{message:string;nonce:Uint8Array;recipient:string;callbackUrl:string}){
  return createHash('sha256').update(challengePayload(p)).digest();
}
export function verifyWalletProof(c:WalletChallenge,proof:{account_id:string;public_key:string;signature:string},owner:string,session:string,origin:string,now=Date.now()){
  if(c.user_id!==owner||c.session_id!==session||c.origin!==origin||!Number.isFinite(Date.parse(c.expires_at))||Date.parse(c.expires_at)<=now)throw Error('Wallet challenge expired or belongs to another session.');
  if(!testnetAccount(proof.account_id)||!proof.public_key.startsWith('ed25519:')||!/^[A-Za-z0-9+/]{86}==$/.test(proof.signature))throw Error('Invalid wallet proof.');
  const nonce=Buffer.from(c.nonce,'base64');if(nonce.length!==32||nonce.toString('base64')!==c.nonce)throw Error('Invalid wallet nonce.');
  if(!PublicKey.fromString(proof.public_key).verify(nep413Digest({message:challengeMessage(c),nonce,recipient:c.origin,callbackUrl:c.origin+'/'}),Buffer.from(proof.signature,'base64')))throw Error('Wallet signature did not match.');
  return createHash('sha256').update(JSON.stringify(proof)).digest('hex');
}

export function inspectPlayerTransaction(signed:string,action:Action,state:GameState,deviceKey:string){
  if(typeof signed!=='string'||signed.length>32_768||!/^[A-Za-z0-9+/]+={0,2}$/.test(signed))throw Error('Invalid signed transaction.');
  const bytes=Buffer.from(signed,'base64');if(bytes.toString('base64')!==signed)throw Error('Invalid signed transaction encoding.');
  const decoded=decodeSignedTransaction(bytes),tx=decoded.transaction,key=PublicKey.fromString(deviceKey),planned=playerCall(action,state);
  // The SDK decoder returns plain Borsh objects, without PublicKey/Signature getters.
  const raw=tx.publicKey as unknown as {ed25519Key?:{data:Uint8Array}},sig=decoded.signature as unknown as {ed25519Signature?:{data:Uint8Array}};
  if(!raw.ed25519Key||!sig.ed25519Signature||baseEncode(new Uint8Array(raw.ed25519Key.data))!==baseEncode(key.data)||key.keyType!==KeyType.ED25519)throw Error('Invalid Ed25519 device signature.');
  const unsigned=createTransaction(tx.signerId,key,tx.receiverId,tx.nonce,tx.actions,tx.blockHash);
  const hash=createHash('sha256').update(encodeTransaction(unsigned)).digest();
  if(tx.signerId!==state.player.account_id||tx.receiverId!==state.environment.contract_id||!key.verify(hash,new Uint8Array(sig.ed25519Signature.data)))throw Error('The player signature does not authorize this shop.');
  const call=tx.actions.length===1?tx.actions[0].functionCall:undefined;
  if(!call||call.methodName!==planned.method||call.deposit!==0n||call.gas!==20_000_000_000_000n)throw Error('Only the selected zero-deposit game action can be relayed.');
  let args;try{args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(new Uint8Array(call.args)));}catch{throw Error('Invalid game arguments.');}
  if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).sort().join(',')!==Object.keys(planned.args).sort().join(',')||Object.entries(planned.args).some(([k,v])=>args[k]!==v))throw Error('Signed arguments do not match the selected action.');
  return {hash:baseEncode(hash),signer:tx.signerId,public_key:deviceKey,method:planned.method,nonce:tx.nonce};
}
