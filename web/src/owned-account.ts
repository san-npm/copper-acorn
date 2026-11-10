import {saveAccountCharacter} from './account-character';
import {createClient} from '@supabase/supabase-js';
import {ownedDevice} from './owned-device';
import {gameMessage} from './game-message';
import {privyConfigured,socialSigner,startSocialLogin,signOutSocial,socialReturn,clearSocialReturn,type SocialReturn} from './privy.ts';
import {bindSocialGame,enableSocialDevice} from './social-access.ts';
import type {GameConnection,CharacterAccount} from './account';
import type {GameState,Action} from './types';

type Save={world_id:string;is_active:boolean;player_owned:boolean;status:string;alchemist:null|{nickname:string;character_id:string}};
export function initOwnedAccount(connected:(c:GameConnection|null,enter?:boolean)=>void,appearance:(a:CharacterAccount|null)=>void){
  const root=document.getElementById('online-account')!;
  root.innerHTML='<h3>Your saved games</h3><p>Continue with Google to find your alchemist, shop and story.</p><p id="owned-status" role="status">Sign in to find your games.</p><button id="owned-login">Continue with Google</button><label id="owned-saves-label" hidden>Saved game <select id="owned-saves"></select></label><button id="owned-check" hidden>Open selected game</button><button id="owned-signout" hidden>Sign out</button>';
  const status=root.querySelector<HTMLElement>('#owned-status')!,button=(id:string)=>root.querySelector<HTMLButtonElement>('#owned-'+id)!;
  const login=button('login'),check=button('check'),signout=button('signout'),select=root.querySelector<HTMLSelectElement>('#owned-saves')!;
  const url=import.meta.env.VITE_PUBLIC_SUPABASE_URL,key=import.meta.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if(!url||!key){login.disabled=true;status.textContent='Online accounts are not configured in this build.';return{prepare:async()=>false,loading:()=>false};}
  const client=createClient(url,key,{auth:{flowType:'pkce'}});
  let owner:string|null=null,generation=0,busy=false,selected=new URL(location.href).searchParams.get('world_id'),state:GameState|null=null,saves:Save[]=[],legacyCharacter:unknown;
  const announce=()=>appearance(owner?{owner,version:generation,character:legacyCharacter,loading:false,save:async(id:string)=>{
    if(saves.find(s=>s.world_id===selected)?.player_owned)throw Error('Choose your character inside a new saved game.');
    const identity=owner,version=generation,{data:{session}}=await client.auth.getSession();
    if(!session||session.user.id!==identity||identity!==owner||version!==generation)throw Error('Sign in again to save your character.');
    await saveAccountCharacter(url,key,session.access_token,session.user.id,id,()=>identity===owner&&version===generation);
    legacyCharacter=id;announce();
  }}:null);
  const worldPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  try{if(!selected)selected=sessionStorage.getItem('copper-acorn.owned-return-world');sessionStorage.removeItem('copper-acorn.owned-return-world');}catch{}
  if(selected&&!worldPattern.test(selected)){status.textContent='This saved-game link is invalid.';login.disabled=true;return{prepare:async()=>false,loading:()=>false};}
  function choose(id:string){selected=id;state=null;const u=new URL(location.href);u.searchParams.set('world_id',id);history.replaceState(history.state,'',u);}
  const raw:GameConnection=async<T>(path:string,init?:RequestInit)=>{
    const started=generation,world=selected,{data:{session}}=await client.auth.getSession();
    if(started!==generation||!session||session.user.id!==owner)throw Error('Sign in again to restore your games.');
    if(path!=='/saves'&&world!==selected)throw Error('Your selected game changed. Open it again.');
    const arena=path.startsWith('/arena?'),endpoint=arena?'arena-api'+path.slice('/arena'.length):'game-api'+path;
    const target=new URL(url+'/functions/v1/'+endpoint);
    if(selected&&path!=='/saves'&&!target.searchParams.has('world_id'))target.searchParams.set('world_id',selected);
    if(arena&&target.searchParams.get('world_id')!==selected)throw Error('Your selected game changed. Re-enter the arena.');
    const response=await fetch(target,{...init,headers:{...init?.headers,apikey:key,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},redirect:'error',signal:AbortSignal.timeout(60_000)});
    const body=await response.json();if(started!==generation)throw Error('Your account changed.');
    if(path!=='/saves'&&world!==selected)throw Error('Your selected game changed. Open it again.');
    if(!response.ok)throw Object.assign(Error(gameMessage(body.error,'The saved game could not be confirmed.')),{status:response.status});
    return body as T;
  };
  const device=ownedDevice(raw,()=>selected);
  const connection:GameConnection=async<T>(path:string,init?:RequestInit)=>{
    if(path==='/new-game'){
      const result=await run(()=>createGame(JSON.parse(String(init?.body)).request_id));
      if(!result)throw Error('Continue with Google to finish setting up your saved game.');
      return result as T;
    }
    if(path==='/action'&&state?.environment.player_owned){const body=JSON.parse(String(init?.body));if(!['serve_customer','market_tick','next_day'].includes((body.action as Action).kind))return device.action(body.request_id,body.action,state) as Promise<T>;}
    const result=await raw<T>(path,init);if(path==='/state')state=result as GameState;return result;
  };
  async function list(){
    const result=await raw<{saves:Save[]}>('/saves');saves=result.saves;
    select.replaceChildren();for(const [index,s] of saves.entries()){const o=document.createElement('option');o.value=s.world_id;o.textContent=s.alchemist?.nickname||(s.status==='ready'?`Saved shop ${index+1}`:'Shop setup in progress');select.append(o);}
    root.querySelector<HTMLElement>('#owned-saves-label')!.hidden=!select.options.length;check.hidden=!select.options.length;
    if(!selected)selected=saves.find(s=>s.is_active)?.world_id||saves[0]?.world_id||null;
    if(selected)select.value=selected;
  }
  function guard(identity:string|null,version:number,world=selected){
    if(!identity||owner!==identity||generation!==version||world!==selected)throw Error('Your account or selected game changed. Open Saved games again.');
  }
  async function signer(intent:SocialReturn){
    const identity=owner,version=generation,world=selected;
    const {data:{user},error}=await client.auth.getUser();guard(identity,version,world);
    const subject=user?.identities?.find(i=>i.provider==='google')?.identity_data?.sub;
    if(error||user?.id!==identity||typeof subject!=='string')throw Error('Sign in with Google again to confirm saved game access.');
    const root=await socialSigner(subject,identity!);guard(identity,version,world);
    if(!root){status.textContent='Continue with the same Google account to protect your saved game…';await startSocialLogin(intent);return null;}
    return root;
  }
  async function createGame(requestId?:string):Promise<{world_id:string}|false>{
    if(!privyConfigured)throw Error('New game setup is temporarily unavailable. Your saved games are kept.');
    const identity=owner,version=generation,world=selected;guard(identity,version,world);
    const slot='copper-acorn.create:'+identity;
    const request=sessionStorage.getItem(slot)||requestId||crypto.randomUUID();sessionStorage.setItem(slot,request);
    const intent:SocialReturn={owner:identity!,world:null,request,created:Date.now()},root=await signer(intent);guard(identity,version,world);
    if(!root)return false;
    status.textContent='Preparing your new saved game…';
    try{
      const result=await bindSocialGame(raw,identity!,request,null,root,()=>guard(identity,version,world));guard(identity,version,world);
      sessionStorage.removeItem(slot);clearSocialReturn();choose(result.world_id);return result;
    }catch(error){if((error as {status?:number}).status===400)sessionStorage.setItem(slot,crypto.randomUUID());throw error;}
  }
  async function open(enter=false){
    const identity=owner,version=generation;
    await list();guard(identity,version);const save=saves.find(s=>s.world_id===selected);
    if(!save){connected(null);status.textContent=saves.length?'Choose one of your saved games above.':privyConfigured?'No saved game was found. Choose New game to open your first shop.':'No saved game was found. New game setup is temporarily unavailable.';return false;}
    choose(save.world_id);
    if(save.status!=='ready'&&!save.player_owned){status.textContent='This shop is still being prepared. Your progress is kept.';return false;}
    if(save.status!=='ready'){
      const deadline=Date.now()+110_000;let result:{ready:boolean;step?:string};
      do{guard(identity,version,save.world_id);status.textContent='Preparing your shop · confirming setup…';result=await raw('/provision',{method:'POST',body:'{}'});if(!result.ready){status.textContent='Preparing your shop · confirming setup…';await new Promise(r=>setTimeout(r,1500));}}while(!result.ready&&Date.now()<deadline);
      guard(identity,version,save.world_id);
      if(!result.ready)throw Error('Setup is saved and still pending. Use Open selected game to check it; your progress is kept.');
    }
    if(save.player_owned&&!await device.ready()){
      guard(identity,version,save.world_id);
      if(!privyConfigured){connected(null);status.textContent='Access from this browser is temporarily unavailable. Your saved game is kept.';return false;}
      const root=await signer({owner:identity!,world:save.world_id,request:crypto.randomUUID(),created:Date.now()});guard(identity,version,save.world_id);
      if(!root)return false;
      status.textContent='Restoring access to your saved game on this browser…';
      await enableSocialDevice(raw,save.world_id,root,()=>guard(identity,version,save.world_id));guard(identity,version,save.world_id);clearSocialReturn();
    }
    guard(identity,version,save.world_id);
    if(save.status!=='ready')await list();
    const current=saves.find(s=>s.world_id===selected)!;
    if(!current.is_active){await raw('/select-save',{method:'POST',body:JSON.stringify({world_id:selected,target_id:selected,expected_active:saves.find(s=>s.is_active)?.world_id})});}
    if(!save.player_owned){
      const identity=owner,version=generation,{data:{user},error}=await client.auth.getUser();
      if(error||user?.id!==identity||identity!==owner||version!==generation)throw Error('Your saved character could not be restored. Try again.');
      legacyCharacter=user.user_metadata?.character_id;announce();
    }
    status.textContent='Your saved shop is ready. Your inventory and story are restored.';
    connected(connection,enter);return true;
  }
  async function run<T>(work:()=>Promise<T>){
    if(busy)return;const started=generation;busy=true;select.disabled=true;
    for(const b of root.querySelectorAll<HTMLButtonElement>('button'))b.disabled=true;
    try{return await work();}
    catch(e){if(started===generation)status.textContent=gameMessage(e instanceof Error?e.message:undefined,'Account access could not be confirmed.');return false;}
    finally{busy=false;select.disabled=false;for(const b of root.querySelectorAll<HTMLButtonElement>('button'))b.disabled=false;check.hidden=!owner||!saves.length;check.disabled=!select.value;announce();if(started!==generation&&owner)setTimeout(()=>void run(()=>open()),0);}
  }
  login.addEventListener('click',()=>void run(async()=>{if(selected)sessionStorage.setItem('copper-acorn.owned-return-world',selected);const {error}=await client.auth.signInWithOAuth({provider:'google',options:{redirectTo:location.origin+'/'}});if(error)throw Error('Google login could not start.');}));
  select.addEventListener('change',()=>{check.disabled=busy||!select.value;});
  check.addEventListener('click',()=>void run(async()=>{if(select.value)choose(select.value);await open(true);}));
  signout.addEventListener('click',()=>void run(async()=>{
    const identity=owner;
    try{await signOutSocial();}
    finally{const {error}=await client.auth.signOut({scope:'local'});if(error)throw Error('Sign-out could not be confirmed.');if(identity)sessionStorage.removeItem('copper-acorn.create:'+identity);}
  }));
  client.auth.onAuthStateChange((event,session)=>{
    if(session?.user.id===owner&&event!=='INITIAL_SESSION')return;
    generation++;owner=session?.user.id||null;state=null;saves=[];legacyCharacter=undefined;select.replaceChildren();root.querySelector<HTMLElement>('#owned-saves-label')!.hidden=true;connected(null);
    announce();
    login.hidden=!!owner;signout.hidden=!owner;check.hidden=true;
    if(owner)setTimeout(()=>void run(async()=>{
      const intent=socialReturn();
      if(privyConfigured&&intent?.owner===owner){
        if(intent.world===null){const result=await createGame(intent.request);if(!result)return false;}
        else choose(intent.world);
        const result=await open(true);if(result)clearSocialReturn();return result;
      }
      return open();
    }),0);else status.textContent='Continue with Google to find your saved games.';
  });
  return{prepare:()=>run(async()=>await createGame()?open(true):false),loading:()=>busy,newGameAvailable:privyConfigured};
}
