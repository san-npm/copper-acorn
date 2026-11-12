import {test,expect,type Page} from '@playwright/test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {KeyPair,PublicKey} from '@near-js/crypto';
import {baseEncode} from '@near-js/utils';
import {decodeSignedTransaction,encodeTransaction} from '@near-js/transactions';
import {implicitAccount} from '../../backend/player-identity';
import {verifyWalletProof,inspectPlayerTransaction} from '../../backend/wallet-proof';
import {gameplayMethods} from '../../backend/player-action';

const origin=process.env.PRIVY_TEST_ORIGIN||'http://127.0.0.1:5189',world='20000000-0000-4000-8000-000000000099',owner='10000000-0000-4000-8000-000000000099',contract='items.ao-fixture.testnet';
async function fixture(page:Page){
  const root=KeyPair.fromRandom('ed25519'),publicKey=root.getPublicKey().toString(),account=implicitAccount(publicKey);
  const challenge={id:randomUUID(),nonce:randomBytes(32).toString('base64'),origin,expires_at:new Date(Date.now()+300_000).toISOString(),session_id:'fixture-session',user_id:owner};
  const {challengeMessage}=await import('../../backend/wallet-proof');
  let signatures=0,links=0,lostLink=false,lostSend=false,expiredChallenge=false,rootQueries=0,session:any=null,pendingOperation:any=null;
  const challengeRequests:string[]=[];
  const operationRequests:string[]=[];let reconciled=false,replacementPending=false;
  const grants=new Map<string,any>(),receipts=new Map<string,any>(),broadcasts:string[]=[],proofs:string[]=[];
  async function install(page:Page){
  await page.route('**/access-harness*',r=>r.fulfill({contentType:'text/html',body:'<div id="online-account"></div>'}));
  await page.exposeFunction('fixtureSign',(bytes:number[])=>{signatures++;return [...root.sign(new Uint8Array(bytes)).signature];});
  await page.exposeFunction('fixtureRequest',async(path:string,init?:{body?:string})=>{
    const b=init?.body?JSON.parse(init.body):null;
    if(path==='/wallet-challenge'){
      challengeRequests.push(b.request_id);const expires_at=expiredChallenge?new Date(Date.now()-1000).toISOString():challenge.expires_at;expiredChallenge=false;
      return {...challenge,expires_at,message:challengeMessage(challenge),recipient:origin,callbackUrl:origin+'/'};
    }
    if(path==='/wallet-link'){
      verifyWalletProof(challenge,b.proof,owner,challenge.session_id,origin);proofs.push(JSON.stringify(b.proof));
      if(!links)links++;
      if(lostLink){lostLink=false;throw Error('Simulated lost binding acknowledgement');}
      return {world_id:world};
    }
    if(path==='/device')return {account_id:account,contract_id:contract,session};
    if(path==='/state')return {pending_operation:pendingOperation};
    if(path.startsWith('/actions/')){operationRequests.push(path);if(reconciled)pendingOperation=replacementPending?{request_id:'second-pending-request',status:'pending'}:null;return {status:reconciled?'confirmed':'pending'};}
    if(path==='/rpc')return grants.has(b.params.public_key)?{...grants.get(b.params.public_key),nonce:0,block_hash:baseEncode(new Uint8Array(32))}:{missing:true};
    if(path==='/action'){
      const state:any={player:{account_id:account,next_action:0},environment:{world_id:world,contract_id:contract},merchants:[]};
      const inspected=inspectPlayerTransaction(b.signed_tx,b.action,state,session.public_key);
      return {status:'confirmed',result:{hash:inspected.hash},error:null};
    }
    throw Error('Unexpected fixture game request '+path);
  });
  await page.route('https://test.rpc.fastnear.com',async route=>{
    const {method,params}=route.request().postDataJSON();let result;
    if(method==='query'){rootQueries++;expect(params.account_id).toBe(account);expect(params.public_key).toBe(publicKey);result={permission:'FullAccess',nonce:receipts.size,block_hash:baseEncode(new Uint8Array(32))};}
    else if(method==='tx'){
      result=receipts.get(params.tx_hash);
      if(!result)return route.fulfill({json:{error:{cause:{name:'UNKNOWN_TRANSACTION'}}}});
    }else{
      expect(method).toBe('send_tx');broadcasts.push(params.signed_tx_base64);
      const signed=decodeSignedTransaction(Buffer.from(params.signed_tx_base64,'base64')),tx=signed.transaction;
      const hash=createHash('sha256').update(encodeTransaction(tx)).digest(),id=baseEncode(hash);
      expect(tx.signerId).toBe(account);expect(PublicKey.fromString(publicKey).verify(hash,new Uint8Array(signed.signature.ed25519Signature!.data))).toBe(true);
      if(!receipts.has(id)){
        if(tx.receiverId===account){
          for(const action of tx.actions){
            if(action.deleteKey){grants.delete('ed25519:'+baseEncode(new Uint8Array(action.deleteKey.publicKey.ed25519Key!.data)));continue;}
            expect(action.addKey).toBeTruthy();
            const key='ed25519:'+baseEncode(new Uint8Array(action.addKey!.publicKey.ed25519Key!.data)),permission=action.addKey!.accessKey.permission.functionCall!;
            expect(permission.receiverId).toBe(contract);expect(permission.methodNames).toEqual(gameplayMethods);expect(permission.allowance).toBe(100_000_000_000_000_000_000_000n);
            grants.set(key,{permission:{FunctionCall:{receiver_id:contract,method_names:gameplayMethods}}});
          }
        }else{
          expect(tx.receiverId).toBe(contract);expect(tx.actions).toHaveLength(1);
          const fn=tx.actions[0].functionCall!;expect(fn.methodName).toBe('authorize_game_session');expect(fn.deposit).toBe(1n);
          const args=JSON.parse(Buffer.from(fn.args).toString());expect(args.actions).toBe(500);expect(args.copper_limit).toBe('100');expect(args.expires_at_ms).toBeLessThanOrEqual(Date.now()+86_400_000);
          session={...args,actions_left:500,copper_left:'100'};
        }
        result={transaction:{hash:id,signer_id:account},status:{SuccessValue:''},receipts_outcome:[],final_execution_status:'FINAL'};receipts.set(id,result);
      }else result=receipts.get(id);
      if(lostSend){lostSend=false;return route.abort();}
    }
    await route.fulfill({json:{result}});
  });
  await page.goto('/access-harness');
  await page.evaluate(({account,publicKey})=>{
    const w=window as any;
    w.signer={account,publicKey,sign:async(d:Uint8Array)=>new Uint8Array(await w.fixtureSign([...d]))};
    w.request=(...args:any[])=>w.fixtureRequest(...args);
  },{account,publicKey});
  }
  await install(page);
  return {install,root,account,publicKey,proofs,broadcasts,receipts,grants,challengeRequests,operationRequests,counts:()=>({signatures,links,rootQueries}),expireChallenge:()=>expiredChallenge=true,loseLink:()=>lostLink=true,loseSend:()=>lostSend=true,session:()=>session,expire:()=>{session.expires_at_ms=0;},pending:()=>{pendingOperation={request_id:'earlier-pending-request',status:'pending'};},confirmPending:(another=false)=>{reconciled=true;replacementPending=another;}};
}

async function enable(page:Page){return page.evaluate(async world=>{
  const {enableSocialDevice}=await import('/src/social-access.ts'),w=window as any;
  try{await enableSocialDevice(w.request,world,w.signer,()=>{});return 'ready';}catch(e){return (e as Error).message;}
},world);}

test('real browser SDK imports without React or Node runtime globals',async({page})=>{
  await page.route('**/access-harness',r=>r.fulfill({contentType:'text/html',body:'<p>SDK import check</p>'}));await page.goto('/access-harness');
  const result=await page.evaluate(async()=>{
    const source=await(await fetch('/src/privy.ts')).text(),match=source.match(/['"]([^'"]*@privy-io_js-sdk-core\.js[^'"]*)['"]/);
    if(!match)throw Error('SDK import URL missing');
    const {default:Privy,LocalStorage}=await import(match[1]),sdk=new Privy({appId:'fixture_app',clientId:'fixture_client',storage:new LocalStorage()});
    return typeof sdk.embeddedWallet.getSolanaProvider;
  });expect(result).toBe('function');
});

test('ownership proof retries identical bytes after a lost acknowledgement and cannot bind a different root',async({page})=>{
  const f=await fixture(page),request=randomUUID();f.loseLink();
  const bind=()=>page.evaluate(async({owner,request})=>{const {bindSocialGame}=await import('/src/social-access.ts'),w=window as any;try{return await bindSocialGame(w.request,owner,request,null,w.signer,()=>{});}catch(e){return (e as Error).message;}},{owner,request});
  expect(await bind()).toContain('lost binding');expect(await bind()).toEqual({world_id:world});
  expect(f.counts()).toMatchObject({signatures:1,links:1});expect(new Set(f.proofs).size).toBe(1);
  await page.evaluate(()=>{(window as any).signer.account='1'.repeat(64);});expect(await bind()).toContain('Google account');expect(f.counts().links).toBe(1);
});

test('lost setup acknowledgement restores the same request after reload; normal play needs no root signatures',async({page})=>{
  const f=await fixture(page);f.loseSend();expect(await enable(page)).toContain('Failed to fetch');
  const bytes=f.broadcasts[0];expect(f.counts().signatures).toBe(1);
  await page.reload();await page.evaluate(({account,publicKey})=>{const w=window as any;w.signer={account,publicKey,sign:async(d:Uint8Array)=>new Uint8Array(await w.fixtureSign([...d]))};w.request=(...args:any[])=>w.fixtureRequest(...args);},{account:f.account,publicKey:f.publicKey});
  expect(await enable(page)).toBe('ready');expect(f.counts().signatures).toBe(2);expect(f.broadcasts).toHaveLength(2);expect(f.broadcasts[0]).toBe(bytes);expect(f.receipts.size).toBe(2);
  const ready=await page.evaluate(async()=>{const {ownedDevice}=await import('/src/owned-device.ts');return ownedDevice((window as any).request,()=> '20000000-0000-4000-8000-000000000099').ready();});expect(ready).toBe(true);
  expect(f.counts().signatures).toBe(2);
  const extractable=await page.evaluate(async world=>{const {stored}=await import('/src/player-device.ts');return (await stored<any>('owned:'+world)).pair.privateKey.extractable;},world);expect(extractable).toBe(false);
  const action=await page.evaluate(async({world,account,contract})=>{
    const {ownedDevice}=await import('/src/owned-device.ts'),device=ownedDevice((window as any).request,()=>world);
    return device.action('fixture-gather',{kind:'gather',token_id:'sunleaf',amount:'2'},{player:{account_id:account,next_action:0},environment:{world_id:world,contract_id:contract},merchants:[]} as any);
  },{world,account:f.account,contract});expect(action.status).toBe('confirmed');expect(f.counts().signatures).toBe(2);
  f.expire();expect(await enable(page)).toBe('ready');expect(f.counts().signatures).toBe(4);expect(f.grants.size).toBe(1);
});

test('pending game actions, wrong roots and identity changes cannot issue device approvals',async({page})=>{
  const f=await fixture(page);f.pending();expect(await enable(page)).toContain('earlier game action');expect(f.counts().signatures).toBe(0);expect(f.broadcasts).toEqual([]);
  await page.evaluate(()=>{(window as any).signer.account='1'.repeat(64);});expect(await enable(page)).toContain('Google account');expect(f.counts().rootQueries).toBe(0);
  const error=await page.evaluate(async()=>{const {bindSocialGame}=await import('/src/social-access.ts'),w=window as any;try{await bindSocialGame(w.request,'owner','request',null,w.signer,()=>{throw Error('Account changed');});}catch(e){return (e as Error).message;}});expect(error).toBe('Account changed');expect(f.counts().signatures).toBe(0);
});

test('a second browser restores the same root and replaces only the earlier limited device key',async({page,browser})=>{
  const f=await fixture(page);expect(await enable(page)).toBe('ready');const earlier=f.session().public_key;expect(f.grants.has(earlier)).toBe(true);
  const context=await browser.newContext();
  try{
    const second=await context.newPage();await f.install(second);expect(await enable(second)).toBe('ready');
    expect(f.session().public_key).not.toBe(earlier);expect(f.grants.has(earlier)).toBe(false);expect(f.grants.size).toBe(1);expect(f.counts().signatures).toBe(4);
    const stillReady=await page.evaluate(async world=>{const {ownedDevice}=await import('/src/owned-device.ts');return ownedDevice((window as any).request,()=>world).ready();},world);expect(stillReady).toBe(false);
  }finally{await context.close();}
});

async function mockSdk(page:Page){
  await page.route('https://auth.privy.io/**',r=>{
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'privy-app-id'};
    if(r.request().method()==='OPTIONS')return r.fulfill({status:204,headers});
    return new URL(r.request().url()).pathname.startsWith('/api/v1/apps/')?r.fulfill({headers,json:{google_oauth:true,allowed_domains:[new URL(page.url()).origin]}}):r.fulfill({contentType:'text/html',body:'<p>isolated signer fixture</p>'});
  });
  await page.route(/@privy-io_js-sdk-core\.js/,r=>r.fulfill({contentType:'text/javascript',body:`
    export class LocalStorage{}
    const user={id:'did:privy:fixture-user',needsWallet:!!window.needsWallet,linked_accounts:[{type:'google_oauth',subject:'google-subject'}]};
    export const getUserEmbeddedSolanaWallet=user=>user.needsWallet?null:({address:window.signer.publicKey.slice(8)}),getUserEmbeddedEthereumWallet=()=>null,getEntropyDetailsFromUser=()=>({entropyId:'fixture',entropyIdVerifier:'fixture'});
    export default class Privy{
      constructor(){if(window.sdkFailure){window.sdkFailure=false;throw Error('Transient SDK setup failure');}}
      initialize=async()=>{};getAccessToken=async()=> window.oauthRequired&&!sessionStorage.getItem('fixture-signer-session')?null:'fixture';user={get:async()=>({user})};auth={logout:async()=>{window.didLogout=true;},oauth:{loginWithCode:async(code,state)=>{if(code!=='fictional-code'||state!=='fictional-state')throw Error('Unexpected callback');window.codeExchanges=(window.codeExchanges||0)+1;sessionStorage.setItem('fixture-signer-session','ready');},generateURL:async()=>{throw Error('Unexpected repeated login');}}};
      embeddedWallet={getURL:()=> 'https://auth.privy.io/apps/fixture/embedded-wallets',onMessage:()=>{window.iframeAccepted=true;window.iframeMessage?.();},createSolana:async opts=>{window.creationKey=opts.idempotencyKey;user.needsWallet=false;return{user};},getSolanaProvider:async()=>({request:async({params})=>{
        if(window.objectReply){window.iframeAccepted=false;window.dispatchEvent(new MessageEvent('message',{origin:'https://auth.privy.io',source:document.querySelector('iframe').contentWindow,data:{event:'fixture-signing-response'}}));if(!window.iframeAccepted)throw Error('Setup approval reply was ignored');}
        const bytes=Uint8Array.from(atob(params.message),c=>c.charCodeAt(0));
        const signature=await window.fixtureSign([...bytes]);
        return {signature:btoa(String.fromCharCode(...signature))};
      }})};setMessagePoster(){}
    }` }));
}

test('a new browser reconciles the same pending action before restoring its device',async({page,browser})=>{
  const f=await fixture(page);expect(await enable(page)).toBe('ready');const earlier=f.session().public_key;
  f.pending();
  const context=await browser.newContext();
  try{
    const second=await context.newPage();await f.install(second);
    expect(await enable(second)).toContain('awaiting confirmation');
    expect(f.counts().signatures).toBe(2);expect(f.grants.has(earlier)).toBe(true);
    f.confirmPending(true);expect(await enable(second)).toContain('awaiting confirmation');
    expect(f.counts().signatures).toBe(2);expect(f.grants.has(earlier)).toBe(true);
    f.pending();f.confirmPending();expect(await enable(second)).toBe('ready');
    expect(f.operationRequests).toEqual(Array(3).fill('/actions/earlier-pending-request'));
    expect(f.counts().signatures).toBe(4);expect(f.grants.has(earlier)).toBe(false);expect(f.grants.size).toBe(1);
    expect(f.broadcasts).toHaveLength(4);
  }finally{await context.close();}
});

test('a failed SDK construction can be retried in the same page',async({page})=>{
  const f=await fixture(page);await mockSdk(page);await page.evaluate(()=>{(window as any).sdkFailure=true;});
  const sign=()=>page.evaluate(async()=>{try{const {socialSigner}=await import('/src/privy.ts');return (await socialSigner('google-subject','owner'))?.account;}catch(e){return (e as Error).message;}});
  expect(await sign()).toBe('Transient SDK setup failure');expect(await sign()).toBe(f.account);
  expect(f.counts().signatures).toBe(0);
});

test('new-game access rejects unconfigured or unrelated origins and retries after configuration without signing early',async({page})=>{
  const f=await fixture(page);await mockSdk(page);let domains:string[]=[];
  await page.route('https://auth.privy.io/api/v1/apps/**',r=>r.fulfill({headers:{'access-control-allow-origin':'*'},json:{google_oauth:true,allowed_domains:domains}}));
  const sign=()=>page.evaluate(async()=>{try{const {socialSigner}=await import('/src/privy.ts');const root=await socialSigner('google-subject','owner');if(!root)throw Error('Signer missing');await root.sign(new Uint8Array(32));return root.account;}catch(e){return (e as Error).message;}});
  expect(await sign()).toContain('still being prepared');expect(f.counts().signatures).toBe(0);expect(await page.locator('iframe').count()).toBe(0);
  domains=[new URL(page.url()).origin+'.example'];expect(await sign()).toContain('still being prepared');expect(f.counts().signatures).toBe(0);
  domains=[new URL(page.url()).origin];expect(await sign()).toBe(f.account);expect(f.counts().signatures).toBe(1);
});

test('first root creation uses a per-user idempotency key and verifies the raw signature',async({page})=>{
  const f=await fixture(page);await mockSdk(page);await page.evaluate(()=>{(window as any).needsWallet=true;});
  const result=await page.evaluate(async()=>{const {socialSigner}=await import('/src/privy.ts'),signer=await socialSigner('google-subject','owner');if(!signer)throw Error('Signer missing');await signer.sign(new Uint8Array(32));return {account:signer.account,creation:(window as any).creationKey};});
  expect(result).toEqual({account:f.account,creation:'copper-acorn-player-v1:did:privy:fixture-user'});expect(f.counts().signatures).toBe(1);
});

test('social signer requires the same Google subject and accepts iframe responses only from its exact window and origin',async({page})=>{
  const f=await fixture(page);let calls=0;await mockSdk(page);
  await page.exposeFunction('iframeMessage',()=>{calls++;});
  const result=await page.evaluate(async()=>{
    const {socialSigner}=await import('/src/privy.ts'),signer=await socialSigner('google-subject','owner');
    if(!signer)throw Error('Signer missing');await signer.sign(new Uint8Array(32));
    const iframe=document.querySelector('iframe')!,data='{"event":"fixture"}';
    window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',source:iframe.contentWindow,data}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://auth.privy.io',source:window,data}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://auth.privy.io',source:iframe.contentWindow,data}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://evil.example',source:iframe.contentWindow,data:JSON.parse(data)}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://auth.privy.io',source:window,data:JSON.parse(data)}));
    window.dispatchEvent(new MessageEvent('message',{origin:'https://auth.privy.io',source:iframe.contentWindow,data:JSON.parse(data)}));
    try{await socialSigner('other-google-account','owner');}catch(e){return {account:signer.account,error:(e as Error).message,logout:(window as any).didLogout};}
  });
  expect(result).toEqual({account:f.account,error:'Use the same Google account for your saved game and game access. Try again.',logout:true});expect(calls).toBe(2);expect(f.counts().signatures).toBe(1);
});

test('an unexpected OAuth callback is rejected and removed before a proof or signature is requested',async({page})=>{
  const f=await fixture(page);await mockSdk(page);
  const result=await page.evaluate(async()=>{
    const {socialSigner,socialReturn}=await import('/src/privy.ts');
    sessionStorage.setItem('copper-acorn.social-return',JSON.stringify({owner:'another-owner',world:null,request:'fixture',created:Date.now()}));
    history.replaceState(null,'','?privy_oauth_code=fictional-code&privy_oauth_state=fictional-state');
    let message='';try{await socialSigner('google-subject','owner');}catch(e){message=(e as Error).message;}
    sessionStorage.setItem('copper-acorn.social-return',JSON.stringify({owner:'owner',world:null,request:'fixture',created:Date.now()-700_000}));
    return {message,url:location.search,intent:socialReturn()};
  });
  expect(result.message).toContain('Start again');expect(result.url).toBe('');expect(result.intent).toBe(null);expect(f.counts().signatures).toBe(0);
});

for(const callback of [false,true])test(`the Google save controller ${callback?'resumes New game after the Google callback':'creates and opens one proven game'}, restores it and signs out both sessions`,async({page})=>{
  const f=await fixture(page);await mockSdk(page);
  const user={id:owner,aud:'authenticated',role:'authenticated',user_metadata:{},identities:[{id:'google-subject',provider:'google',identity_data:{sub:'google-subject'}}]},expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:owner,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
  await page.evaluate(({user,token,expires})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,token,expires});
  await page.route('https://example.supabase.co/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;
    const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'};
    if(r.method()==='OPTIONS'||path.endsWith('/logout'))return route.fulfill({status:204,headers});
    if(path==='/auth/v1/user')return route.fulfill({json:user,headers});
    const name=path.split('/game-api')[1];
    if(name==='/saves')return route.fulfill({json:{saves:f.counts().links?[{world_id:world,is_active:true,player_owned:true,status:'ready',alchemist:null}]:[],limit:2},headers});
    expect(r.headers().authorization).toBe('Bearer '+token);
    const result=await page.evaluate(async({name,body})=>(window as any).fixtureRequest(name,{body}),{name,body:r.postData()});
    return route.fulfill({json:result,headers});
  });
  const callbackRequest=randomUUID();
  if(callback)await page.evaluate(({owner,request})=>{
    Object.assign(window,{oauthRequired:true,objectReply:true,needsWallet:true});
    sessionStorage.setItem('copper-acorn.social-return',JSON.stringify({owner,world:null,request,created:Date.now()}));
    history.replaceState(null,'','?privy_oauth_code=fictional-code&privy_oauth_state=fictional-state');
  },{owner,request:callbackRequest});
  await page.evaluate(async()=>{const {initOwnedAccount}=await import('/src/owned-account.ts'),w=window as any;w.controls=initOwnedAccount((c,enter)=>{w.connection=c;w.enter=enter;},()=>{});});
  if(!callback){
    await expect(page.locator('#owned-status')).toContainText('No saved game was found');expect(f.counts().links).toBe(0);
    f.expireChallenge();expect(await page.evaluate(async()=>(window as any).controls.prepare())).toBe(false);expect(f.counts().signatures).toBe(0);
    expect(await page.evaluate(async()=>(window as any).controls.prepare())).toBe(true);
    expect(f.challengeRequests).toHaveLength(2);expect(f.challengeRequests[0]).not.toBe(f.challengeRequests[1]);
  }
  await expect(page.locator('#owned-status')).toContainText('Your saved shop is ready');expect(f.counts()).toMatchObject({links:1,signatures:3});
  if(callback){
    expect(f.challengeRequests).toEqual([callbackRequest]);
    expect(await page.evaluate(()=>({exchanges:(window as any).codeExchanges,enter:(window as any).enter,query:location.search,intent:sessionStorage.getItem('copper-acorn.social-return')}))).toEqual({exchanges:1,enter:true,query:'?world_id='+world,intent:null});
    expect(await page.evaluate(()=>(window as any).creationKey)).toBe('copper-acorn-player-v1:did:privy:fixture-user');
  }
  await page.locator('#owned-check').click();await expect(page.locator('#owned-status')).toContainText('Your saved shop is ready');expect(f.counts().signatures).toBe(3);
  expect(await page.locator('#online-account').innerText()).not.toMatch(/wallet|near|privy|crypto|blockchain/i);
  await page.locator('#owned-signout').click();await expect(page.locator('#owned-login')).toBeVisible();expect(await page.evaluate(()=>(window as any).didLogout)).toBe(true);
});
