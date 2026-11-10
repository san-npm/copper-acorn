import {test,expect,type BrowserContext} from '@playwright/test';
import {decodeSignedTransaction} from '@near-js/transactions';
import {baseEncode} from '@near-js/utils';

const technical=/\b(?:NEAR|Jev|wallet|crypto|blockchain|testnet|Sandbox|onchain|gas|token|Supabase|RPC|contract|transaction|signature|inference)\b/i;
const world='20000000-0000-4000-8000-000000000099';

test('an earlier Google save opens, crafts, sells and reloads without a new account or wallet',async({page,request})=>{
  const original=await(await request.get('http://127.0.0.1:3911/api/state')).json(),localWorld=original.environment.world_id;
  const user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'magician'}},expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
  const writes:string[]=[],popups:string[]=[],cosmetics:string[]=[];
  await page.addInitScript(({user,token,expires})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,token,expires});
  page.on('popup',p=>popups.push(p.url()));
  await page.route('https://example.supabase.co/**',async route=>{
    const r=route.request(),path=new URL(r.url()).pathname;let body:any=user;
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
    if(path.endsWith('/saves'))body={saves:[{world_id:world,player_owned:false,is_active:true,status:'ready',alchemist:null}],limit:2,active_world_id:world};
    else if(path.endsWith('/state')){
      body=await(await request.get('http://127.0.0.1:3911/api/state')).json();delete body.batch_limit;delete body.alchemist;body.environment={...body.environment,network:'testnet',world_id:world,player_owned:false};
    }else if(path.endsWith('/action')){
      const b=r.postDataJSON();expect(b.world_id).toBe(world);expect(b.signed_tx).toBeUndefined();writes.push(b.action.kind);
      const result=await request.post('http://127.0.0.1:3911/api/action',{data:{...b,world_id:localWorld}});expect(result.ok()).toBe(true);body=await result.json();expect(body.status).toBe('confirmed');
    }else{
      expect(path).toBe('/auth/v1/user');
      if(r.method()==='PUT'){
        expect(r.headers().authorization).toBe('Bearer '+token);expect(r.postDataJSON()).toEqual({data:{character_id:'goblin'}});
        Object.assign(user.user_metadata,r.postDataJSON().data);cosmetics.push(user.user_metadata.character_id);body=user;
      }
    }
    return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto('/');await expect(page.locator('#copper')).toHaveText('40');await expect(page.locator('#character-name')).toHaveText('Magician');
  await page.getByRole('button',{name:'Saved games',exact:true}).click();await expect(page.locator('#owned-saves')).toHaveValue(world);await expect(page.locator('#owned-check')).toBeEnabled();
  expect(await page.locator('#games-dialog').innerText()).not.toMatch(technical);await page.locator('#owned-check').click();await expect(page.locator('#games-dialog')).not.toBeVisible();
  expect(writes).toEqual([]);
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await page.getByRole('button',{name:'Brew Healing Tonic',exact:true}).click();await expect(page.locator('#copper')).toHaveText('39');
  await page.getByRole('button',{name:'Shelves',exact:true}).click();await page.getByLabel('Price in Copper').fill('13');await page.getByRole('button',{name:'Put on shelf',exact:true}).click();
  await page.getByRole('button',{name:'Customers',exact:true}).click();await page.getByRole('button',{name:'Serve gardener · 13 Copper',exact:true}).click();await expect(page.locator('#copper')).toHaveText('52');
  await page.reload();await expect(page.locator('#copper')).toHaveText('52');await expect(page.locator('#character-name')).toHaveText('Magician');expect(writes).toEqual(['brew','list','serve_customer']);
  await page.locator('#choose-character').click();await page.locator('#character-choices input[value="goblin"]').check();await page.locator('#use-character').click();await expect(page.locator('#character-name')).toHaveText('Goblin');
  await page.reload();await expect(page.locator('#character-name')).toHaveText('Goblin');await expect(page.locator('#copper')).toHaveText('52');expect(cosmetics).toEqual(['goblin']);expect(writes).toEqual(['brew','list','serve_customer']);expect(popups).toEqual([]);
  await page.screenshot({path:'.local/earlier-save-restored.png',fullPage:true});
});

test('no saved games means no dead Open button and no implicit allocation',async({page})=>{
  const user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',user_metadata:{}},expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');const writes:string[]=[];
  await page.addInitScript(({user,token,expires})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,token,expires});
  await page.route('https://example.supabase.co/**',async route=>{if(route.request().method()!=='GET')writes.push(route.request().method());const body=new URL(route.request().url()).pathname.endsWith('/saves')?{saves:[],limit:2}:user;await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});});
  await page.goto('/');await expect(page.locator('#owned-status')).toContainText('No saved game was found');await expect(page.locator('#owned-check')).toBeHidden();await expect(page.locator('#owned-saves-label')).toBeHidden();await expect(page.locator('#new-game')).toBeDisabled();expect(writes).toEqual([]);
});

test('Mira chat errors keep service names and diagnostics out of the conversation',async({page})=>{
  await page.goto('/');
  await page.evaluate(async()=>{
    const {miraDialog}=await import('/src/mira-dialog.ts');
    const dialog=document.createElement('dialog');dialog.id='mira-language-test';dialog.innerHTML='<p id="interaction-text">Mira opens her book.</p>';document.body.append(dialog);dialog.showModal();
    miraDialog(dialog,async()=>{throw Error('Jev inference failed: RPC token rejected');},async()=>{throw Error('No player action expected');}).open();
  });
  await expect(page.locator('#mira-language-test .mira-status')).toContainText('Your game could not be confirmed');
  expect(await page.locator('#mira-language-test').innerText()).not.toMatch(technical);
  expect(await page.locator('#mira-language-test input').getAttribute('placeholder')).not.toMatch(technical);
});

test('Google is the only sign-in; welcome shows no technical setup',async({page})=>{
  const requests:string[]=[],errors:string[]=[];
  page.on('request',r=>requests.push(r.url()));page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://example.supabase.co/auth/v1/authorize**',route=>route.fulfill({contentType:'text/html',body:'Google sign-in fixture'}));
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Continue with Google',exact:true})).toBeVisible();
  expect(await page.locator('body').innerText()).not.toMatch(technical);await expect(page.locator('#owned-saves-label')).toBeHidden();
  await page.screenshot({path:'.local/game-language-welcome.png',fullPage:true});
  const google=page.waitForRequest(r=>r.url().includes('/auth/v1/authorize'));
  await page.getByRole('button',{name:'Continue with Google',exact:true}).click();
  const target=new URL((await google).url());expect(target.searchParams.get('provider')).toBe('google');expect(target.searchParams.get('code_challenge_method')).toBe('s256');
  expect(requests.some(u=>/mynearwallet|wallet-link|wallet-challenge|\/provision/.test(u))).toBe(false);expect(errors).toEqual([]);
});

test('existing device keeps signed play and reload; new browser cannot silently replace access',async({page,request,browser})=>{
  const initial=await(await request.get('http://127.0.0.1:3911/api/state')).json();
  const user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',user_metadata:{}},expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
  Object.assign(initial.environment,{network:'testnet',world_id:world,contract_id:'items.ao-fictional.testnet',player_owned:true,is_active:true});initial.player.account_id='fictional.testnet';initial.alchemist=null;initial.pending_operation=null;
  let grantKey='',signedCalls=0,stateFailure=false;
  const requests:string[]=[],errors:string[]=[],popups:string[]=[];
  async function install(context:BrowserContext){
    await context.addInitScript(({token,expires,user})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{token,expires,user});
    await context.route('https://example.supabase.co/**',async route=>{
      const r=route.request(),path=new URL(r.url()).pathname,b=r.method()==='POST'?r.postDataJSON():null;requests.push(path);
      if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
      let result:any;
      if(path==='/auth/v1/user')result=user;
      else if(path.endsWith('/saves'))result={saves:[{world_id:world,is_active:true,player_owned:true,status:'ready',alchemist:initial.alchemist}],limit:2,active_world_id:world};
      else if(path.endsWith('/device'))result={account_id:initial.player.account_id,contract_id:initial.environment.contract_id,session:{public_key:grantKey,expires_at_ms:Date.now()+3600000,actions_left:500,copper_left:'100'}};
      else if(path.endsWith('/rpc'))result={nonce:0,block_hash:baseEncode(new Uint8Array(32))};
      else if(path.endsWith('/state')){
        if(stateFailure)return route.fulfill({status:503,json:{error:'NEAR testnet RPC failed: secret internal nonce'},headers:{'access-control-allow-origin':'*'}});
        result=initial;
      }else if(path.endsWith('/action')){
        const tx=decodeSignedTransaction(Buffer.from(b.signed_tx,'base64')).transaction;
        expect(tx.signerId).toBe(initial.player.account_id);expect(tx.receiverId).toBe(initial.environment.contract_id);expect(tx.actions[0].functionCall!.deposit).toBe(0n);signedCalls++;
        expect(b.action.kind).toBe('choose_alchemist');initial.alchemist={nickname:b.action.nickname,character_id:b.action.character_id};initial.player.next_action++;
        result={status:'confirmed',result:{hash:'fixture-confirmed'},error:null};
      }else throw Error('Unexpected hosted route '+path);
      return route.fulfill({json:result,headers:{'access-control-allow-origin':'*'}});
    });
  }
  page.on('pageerror',e=>errors.push(e.message));page.on('popup',child=>popups.push(child.url()));
  await install(page.context());await page.goto('/?world_id='+world);
  await expect(page.locator('#owned-status')).toContainText('Access from this browser is temporarily unavailable');
  grantKey=await page.evaluate(async world=>{const {stored,deviceKey}=await import('/src/player-device.ts');const key=await deviceKey();await stored('owned:'+world,{pair:key.pair,publicKey:key.publicKey});return key.publicKey;},world);
  await page.locator('#owned-check').click();await expect(page.locator('#owned-status')).toContainText('Your saved shop is ready');
  await expect(page.locator('#character-dialog')).toBeVisible();await page.locator('#nickname').fill('Gobo');await page.locator('#use-character').click();
  await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');expect(signedCalls).toBe(1);
  await page.reload();await expect(page.locator('#character-name')).toHaveText('Gobo · Goblin');
  await page.getByRole('button',{name:'Market',exact:true}).click();await expect(page.locator('#panel')).not.toContainText('contract');
  expect(await page.locator('body').innerText()).not.toMatch(technical);await expect(page.locator('.technical')).toHaveCount(0);await expect(page.locator('#receipt-detail')).toHaveCount(0);
  await page.screenshot({path:'.local/game-language-shop.png',fullPage:true});
  stateFailure=true;await page.locator('#refresh').click();await expect(page.locator('#action-status')).toContainText('Refresh ledger');expect(await page.locator('#action-status').innerText()).not.toMatch(technical);stateFailure=false;
  const second=await browser.newContext({viewport:{width:320,height:800}});
  try{await install(second);const p=await second.newPage();await p.goto('http://127.0.0.1:5182/?world_id='+world);await expect(p.locator('#owned-status')).toContainText('Access from this browser is temporarily unavailable');await expect(p.locator('#new-game')).toBeDisabled();expect(await p.locator('body').innerText()).not.toMatch(technical);expect(initial.alchemist.nickname).toBe('Gobo');expect(signedCalls).toBe(1);}
  finally{await second.close();}
  expect(requests.some(u=>/wallet-link|wallet-challenge|\/provision/.test(u))).toBe(false);expect(popups).toEqual([]);expect(errors).toEqual([]);
});

test('a stale saved-game link recovers when the player selects an available save',async({page,request})=>{
 const world='20000000-0000-4000-8000-000000000099',stale='20000000-0000-4000-8000-000000000098',user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'goblin'}},expires=Math.floor(Date.now()/1000)+3600;
 const state=await(await request.get('http://127.0.0.1:3911/api/state')).json();delete state.batch_limit;delete state.alchemist;Object.assign(state.environment,{network:'testnet',world_id:world,player_owned:false});state.player.balances.copper='40';
 const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
 await page.addInitScript(({user,expires,token})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,expires,token});
 await page.route('https://example.supabase.co/**',async route=>{const path=new URL(route.request().url()).pathname;const body=path.endsWith('/saves')?{saves:[{world_id:world,player_owned:false,is_active:true,status:'ready',alchemist:null}],limit:2}:path.endsWith('/state')?state:user;await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});});
 await page.goto('/?world_id='+stale);await expect(page.locator('#owned-status')).toContainText('Choose one of your saved games');
 await page.locator('#owned-saves').selectOption(world);await expect(page.locator('#owned-check')).toBeEnabled();
 await page.locator('#owned-check').click();await expect(page.locator('#copper')).toHaveText('40');await expect(page.locator('#games-dialog')).not.toBeVisible();
});

test('switching Google accounts during a save lookup resumes the new account after the old response',async({page,request})=>{
 const a={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'goblin'}},b={...a,id:'10000000-0000-4000-8000-000000000002',user_metadata:{character_id:'dwarf'}},worldA='20000000-0000-4000-8000-000000000001',worldB='20000000-0000-4000-8000-000000000002',expires=Math.floor(Date.now()/1000)+3600;
 const token=(u:typeof a)=>['header',Buffer.from(JSON.stringify({sub:u.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
 const session=(u:typeof a)=>({access_token:token(u),refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user:u});
 const state=await(await request.get('http://127.0.0.1:3911/api/state')).json();delete state.batch_limit;delete state.alchemist;Object.assign(state.environment,{network:'testnet',world_id:worldB,player_owned:false});state.player.balances.copper='77';
 let started=false,active=a,release!:()=>void;const held=new Promise<void>(r=>release=r);
 await page.addInitScript(session=>localStorage.setItem('sb-example-auth-token',JSON.stringify(session)),session(a));
 await page.route('https://example.supabase.co/**',async route=>{
  const path=new URL(route.request().url()).pathname;let body:any=active;
  if(path.endsWith('/saves')){const old=route.request().headers().authorization==='Bearer '+token(a);if(old){started=true;await held;}body={saves:[{world_id:old?worldA:worldB,is_active:true,player_owned:false,status:'ready',alchemist:null}],limit:2};}
  if(path.endsWith('/state'))body=state;
  await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('/');await expect.poll(()=>started).toBe(true);active=b;
 await page.evaluate(session=>{localStorage.setItem('sb-example-auth-token',JSON.stringify(session));new BroadcastChannel('sb-example-auth-token').postMessage({event:'SIGNED_IN',session});},session(b));
 await page.waitForTimeout(100);release();await expect(page.locator('#copper')).toHaveText('77');await expect(page.locator('#character-name')).toHaveText('Dwarf');
});

test('a late response from the previous selected save cannot replace the current connection state',async({page,request})=>{
 const old='20000000-0000-4000-8000-000000000001',next='20000000-0000-4000-8000-000000000002',user={id:'10000000-0000-4000-8000-000000000099',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'goblin'}},expires=Math.floor(Date.now()/1000)+3600;
 const initial=await(await request.get('http://127.0.0.1:3911/api/state')).json();delete initial.batch_limit;delete initial.alchemist;
 const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'fixture'].join('.');
 let active=old,started=false,saveReads=0,release!:()=>void;const held=new Promise<void>(r=>release=r);
 await page.addInitScript(({user,expires,token})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,expires,token});
 await page.route('**/review-harness',r=>r.fulfill({contentType:'text/html',body:'<section id="online-account"></section>'}));
 await page.route('https://example.supabase.co/**',async route=>{
  const u=new URL(route.request().url()),path=u.pathname;let body:any=user;
  if(path.endsWith('/saves')){saveReads++;body={saves:[old,next].map(world_id=>({world_id,is_active:world_id===active,player_owned:false,status:'ready',alchemist:null})),limit:2};}
  if(path.endsWith('/select-save')){active=route.request().postDataJSON().target_id;body={world_id:active};}
  if(path.endsWith('/state')){const id=u.searchParams.get('world_id');if(id===old){started=true;await held;}body={...initial,environment:{...initial.environment,network:'testnet',world_id:id,player_owned:false}};}
  await route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
 });
 await page.goto('/review-harness');await page.evaluate(async()=>{const {initOwnedAccount}=await import('/src/owned-account.ts');initOwnedAccount(c=>{if(c){(window as any).auditConnection=c;(window as any).connections=((window as any).connections||0)+1;}},()=>{});});
 await expect.poll(()=>page.evaluate(()=>(window as any).connections)).toBe(1);expect(saveReads).toBe(1);
 await page.evaluate(()=>{(window as any).oldRead=(window as any).auditConnection('/state').then(()=>({accepted:true}),e=>({accepted:false,message:e.message}));});await expect.poll(()=>started).toBe(true);
 await page.locator('#owned-saves').selectOption(next);await page.locator('#owned-check').click();await expect.poll(()=>page.evaluate(()=>(window as any).connections)).toBe(2);expect(saveReads).toBe(2);
 await page.evaluate(()=>(window as any).auditConnection('/state'));release();const result=await page.evaluate(()=>(window as any).oldRead);expect(result.accepted).toBe(false);
});
