import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {KeyPair,KeyType} from '@near-js/crypto';
import {actionCreators,createTransaction,encodeTransaction,Signature,SignedTransaction} from '@near-js/transactions';
import {verifyWalletProof,challengeMessage,inspectPlayerTransaction,type WalletChallenge} from './wallet-proof.ts';
import type {GameState} from '../web/src/types.ts';

const key=KeyPair.fromRandom('ed25519'),device=key.getPublicKey().toString();
const challenge:WalletChallenge={id:'challenge-1',nonce:randomBytes(32).toString('base64'),origin:'https://game.example',expires_at:new Date(Date.now()+60_000).toISOString(),session_id:'session',user_id:'owner'};
function messageSignature(c:WalletChallenge){
  const str=(s:string)=>{const b=Buffer.from(s),l=Buffer.alloc(4);l.writeUInt32LE(b.length);return Buffer.concat([l,b]);};
  const tag=Buffer.alloc(4);tag.writeUInt32LE(2**31+413);
  const payload=Buffer.concat([tag,str(challengeMessage(c)),Buffer.from(c.nonce,'base64'),str(c.origin),Buffer.from([1]),str(c.origin+'/')]);
  return Buffer.from(key.sign(createHash('sha256').update(payload).digest()).signature).toString('base64');
}
test('NEP-413 proof binds nonce, site, session, owner and expiry',()=>{
  const proof={account_id:'fictional.testnet',public_key:device,signature:messageSignature(challenge)};
  assert.match(verifyWalletProof(challenge,proof,'owner','session',challenge.origin),/^[a-f0-9]{64}$/);
  for(const [owner,session,origin] of [['other','session',challenge.origin],['owner','other',challenge.origin],['owner','session','https://evil.example']])assert.throws(()=>verifyWalletProof(challenge,proof,owner,session,origin));
  assert.throws(()=>verifyWalletProof({...challenge,nonce:randomBytes(32).toString('base64')},proof,'owner','session',challenge.origin));
  assert.throws(()=>verifyWalletProof(challenge,proof,'owner','session',challenge.origin,Date.now()+120_000));
  assert.throws(()=>verifyWalletProof(challenge,{...proof,account_id:'main.near'},'owner','session',challenge.origin));
});
const state={player:{account_id:'fictional.testnet',next_action:4},environment:{contract_id:'shop.fictional.testnet'},merchants:[]} as unknown as GameState;
function signed(change:{receiver?:string;deposit?:bigint;method?:string;args?:object;signer?:string;extra?:boolean}={}){
  const action=actionCreators.functionCall(change.method||'gather',Buffer.from(JSON.stringify(change.args||{token_id:'sunleaf',amount:'2',nonce:4})),20_000_000_000_000n,change.deposit||0n);
  const tx=createTransaction(change.signer||state.player.account_id,key.getPublicKey(),change.receiver||state.environment.contract_id!,1n,change.extra?[action,action]:[action],new Uint8Array(32));
  const hash=createHash('sha256').update(encodeTransaction(tx)).digest();
  return Buffer.from(new SignedTransaction({transaction:tx,signature:new Signature({keyType:KeyType.ED25519,data:key.sign(hash).signature})}).encode()).toString('base64');
}
test('player relay accepts only the actual device signature for the exact selected zero-deposit action',()=>{
  const action={kind:'gather' as const,token_id:'sunleaf',amount:'2'};
  assert.equal(inspectPlayerTransaction(signed(),action,state,device).method,'gather');
  for(const change of [{receiver:'evil.testnet'},{signer:'other.testnet'},{deposit:1n},{method:'mt_transfer'},{args:{token_id:'sunleaf',amount:'2',nonce:3}},{args:{token_id:'sunleaf',amount:'2',nonce:4,extra:true}},{extra:true}])assert.throws(()=>inspectPlayerTransaction(signed(change),action,state,device));
  const broken=Buffer.from(signed(),'base64');broken[broken.length-1]^=1;
  assert.throws(()=>inspectPlayerTransaction(broken.toString('base64'),action,state,device));
});
