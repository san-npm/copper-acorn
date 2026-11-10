import {serialize} from 'borsh';
import {PublicKey,KeyType} from '@near-js/crypto';

export function implicitAccount(publicKey:string){
  const key=PublicKey.fromString(publicKey);
  if(key.keyType!==KeyType.ED25519||key.data.length!==32||key.toString()!==publicKey)throw Error('Invalid player identity.');
  return Array.from(key.data,b=>b.toString(16).padStart(2,'0')).join('');
}

export function challengePayload(p:{message:string;nonce:Uint8Array;recipient:string;callbackUrl:string}){
  if(p.nonce.length!==32)throw Error('Invalid login challenge.');
  return serialize({struct:{tag:'u32',message:'string',nonce:{array:{type:'u8',len:32}},recipient:'string',callbackUrl:{option:'string'}}},{tag:2**31+413,...p});
}
