import type Privy from '@privy-io/js-sdk-core';
import {Buffer} from 'buffer';
import {PublicKey} from '@near-js/crypto';
import {implicitAccount} from '../../backend/player-identity.ts';

const appId=import.meta.env.VITE_PUBLIC_PRIVY_APP_ID,clientId=import.meta.env.VITE_PUBLIC_PRIVY_CLIENT_ID;
export const privyConfigured=!!appId;
const intentKey='copper-acorn.social-return';
export type SocialReturn={owner:string;world:string|null;request:string;created:number};
export type PlayerSigner={account:string;publicKey:string;sign:(digest:Uint8Array)=>Promise<Uint8Array>};
let instance:Promise<Privy>|undefined;
let sdkObject:Promise<Privy>|undefined;
async function sdkClient(){
  return sdkObject??= (async()=>{
    const {default:Privy,LocalStorage}=await import('@privy-io/js-sdk-core');
    return new Privy({appId,clientId,storage:new LocalStorage(),sessions:{cookieWriteBehavior:'never'}});
  })().catch(error=>{sdkObject=undefined;throw error;});
}

export function socialReturn():SocialReturn|null{
  const raw=sessionStorage.getItem(intentKey);if(!raw)return null;
  try{
    const value=JSON.parse(raw);
    if(typeof value.owner==='string'&&(value.world===null||typeof value.world==='string')&&typeof value.request==='string'&&Number.isFinite(value.created)&&Date.now()>=value.created&&Date.now()-value.created<600_000)return value;
  }catch{}
  sessionStorage.removeItem(intentKey);return null;
}
export function clearSocialReturn(){sessionStorage.removeItem(intentKey);}

async function client(){
  if(!privyConfigured)throw Error('New game setup is temporarily unavailable. Your saved games are kept.');
  return instance??= (async()=>{
    const settings=await fetch('https://auth.privy.io/api/v1/apps/'+appId,{headers:{'privy-app-id':appId},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10_000)});
    if(!settings.ok)throw Error('New game setup could not be checked. Try again shortly.');
    const config=await settings.json();
    if(config.google_oauth!==true||!Array.isArray(config.allowed_domains)||!config.allowed_domains.includes(location.origin))throw Error('This game address is still being prepared. Try again shortly; your saved games are kept.');
    const sdk=await sdkClient();
    await sdk.initialize();
    const iframe=document.createElement('iframe'),target=new URL(sdk.embeddedWallet.getURL());
    if(target.origin!=='https://auth.privy.io')throw Error('Game access could not be initialized.');
    iframe.src=target.href;iframe.hidden=true;iframe.title='Saved game access';
    window.addEventListener('message',event=>{
      if(event.source!==iframe.contentWindow||event.origin!==target.origin||typeof event.data!=='string')return;
      try{sdk.embeddedWallet.onMessage(JSON.parse(event.data));}catch{}
    });
    document.body.append(iframe);sdk.setMessagePoster({postMessage:message=>iframe.contentWindow!.postMessage(message,target.origin),reload:()=>{iframe.src=target.href;}});
    return sdk;
  })().catch(error=>{instance=undefined;throw error;});
}

export async function startSocialLogin(intent:SocialReturn){
  const sdk=await client();
  sessionStorage.setItem(intentKey,JSON.stringify(intent));
  const {url}=await sdk.auth.oauth.generateURL('google',location.origin);
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password)throw Error('Google login could not start.');
  location.assign(target.href);
}

export async function socialSigner(subject:string,owner:string):Promise<PlayerSigner|null>{
  const sdk=await client(),address=new URL(location.href),code=address.searchParams.get('privy_oauth_code'),state=address.searchParams.get('privy_oauth_state');
  if(code||state){
    try{
      if(!code||!state||socialReturn()?.owner!==owner)throw Error('Google login could not be confirmed. Start again from Saved games.');
      await sdk.auth.oauth.loginWithCode(code,state);
    }
    finally{address.searchParams.delete('privy_oauth_code');address.searchParams.delete('privy_oauth_state');history.replaceState(history.state,'',address);}
  }
  if(!await sdk.getAccessToken())return null;
  let {user}=await sdk.user.get();if(!user)return null;
  if(!subject||!user.linked_accounts.some(a=>a.type==='google_oauth'&&a.subject===subject)){
    await sdk.auth.logout();throw Error('Use the same Google account for your saved game and game access. Try again.');
  }
  const {getUserEmbeddedSolanaWallet,getUserEmbeddedEthereumWallet,getEntropyDetailsFromUser}=await import('@privy-io/js-sdk-core');
  let wallet=getUserEmbeddedSolanaWallet(user);
  if(!wallet){
    ({user}=await sdk.embeddedWallet.createSolana({ethereumAccount:getUserEmbeddedEthereumWallet(user)||undefined,idempotencyKey:'copper-acorn-player-v1:'+user.id}));
    wallet=getUserEmbeddedSolanaWallet(user);
  }
  const entropy=wallet&&getEntropyDetailsFromUser(user,wallet);
  if(!wallet||!entropy)throw Error('Saved game access could not be prepared.');
  const provider=await sdk.embeddedWallet.getSolanaProvider(wallet,entropy.entropyId,entropy.entropyIdVerifier);
  const publicKey='ed25519:'+wallet.address,account=implicitAccount(publicKey);
  return {publicKey,account,async sign(digest){
    if(digest.length!==32)throw Error('Invalid saved-game request.');
    // This provider signs raw Ed25519 bytes; no Solana transaction or account is used.
    const response=await provider.request({method:'signMessage',params:{message:Buffer.from(digest).toString('base64')}});
    const signature=Buffer.from(response.signature,'base64');
    if(signature.length!==64||signature.toString('base64')!==response.signature||!PublicKey.fromString(publicKey).verify(digest,new Uint8Array(signature)))throw Error('Saved game approval could not be verified.');
    return new Uint8Array(signature);
  }};
}

export async function signOutSocial(){
  clearSocialReturn();
  if(privyConfigured)await(await sdkClient()).auth.logout();
}
