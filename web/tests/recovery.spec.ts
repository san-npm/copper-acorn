import {test,expect,openAccount,type Page,type APIRequestContext} from './legacy';

async function savedShop(page:Page,request:APIRequestContext) {
  const state=await(await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  const world='20000000-0000-4000-8000-000000000001',owner='10000000-0000-4000-8000-000000000001';
  const account='ca-'+world.replaceAll('-','')+'.testnet';
  state.environment.network='testnet';state.environment.world_id=world;
  state.player.account_id=account;Object.assign(state.player.balances,{copper:'40',sunleaf:'4',spring_water:'3',healing_tonic:'0'});
  state.pending_operation=null;delete state.market;
  const user={id:owner,aud:'authenticated',role:'authenticated',email_confirmed_at:'2026-11-05T00:00:00Z',user_metadata:{character_id:'goblin'}};
  const expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:owner,exp:expires,session_id:'30000000-0000-4000-8000-000000000001'})).toString('base64url'),'simulated'].join('.');
  await page.addInitScript(({user,token,expires})=>{
    localStorage.setItem('copper-acorn.sandbox-character','goblin');
    if(!sessionStorage.getItem('test-signed-out'))localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated',expires_at:expires,expires_in:3600,token_type:'bearer',user}));
  },{user,token,expires});
  await page.route('https://example.supabase.co/auth/v1/user',r=>r.fulfill({json:user}));
  await page.route('https://example.supabase.co/auth/v1/logout**',r=>r.fulfill({status:204,body:''}));
  await page.route('https://example.supabase.co/functions/v1/game-session',r=>r.fulfill({json:{world:{id:world,status:'ready'},wallet:{account_id:account,funded_at:'2026-11-05T00:00:00Z',funding_requested_at:'2026-11-05T00:00:00Z'}}}));
  return {state,world,brew:()=>Object.assign(state.player.balances,{copper:'39',sunleaf:'2',spring_water:'2',healing_tonic:'1'})};
}

test('confirmed brew stays locked until an interrupted stock refresh succeeds',async({page,request})=>{
  const f=await savedShop(page,request);let offline=false,writes=0;
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state')return offline?r.fulfill({status:503,json:{error:'Saved shop is temporarily unavailable.'}}):r.fulfill({json:f.state});
    expect(path).toBe('/action');writes++;f.brew();offline=true;
    return r.fulfill({json:{status:'confirmed',result:{hash:'confirmed-brew'},error:null}});
  });
  await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await page.getByRole('button',{name:'Brew Healing Tonic',exact:true}).click();
  await expect(page.locator('#action-status')).toContainText('Action confirmed');
  await expect(page.locator('#brew-healing_tonic')).toBeDisabled({timeout:1500});
  await page.locator('#refresh').click();await expect(page.locator('#action-status')).toContainText('temporarily unavailable');
  await expect(page.locator('#brew-healing_tonic')).toBeDisabled();
  offline=false;await page.locator('#refresh').click();
  await expect(page.locator('#copper')).toHaveText('39');await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('1');
  await expect(page.locator('#brew-healing_tonic')).toBeEnabled();expect(writes).toBe(1);
});

test('refresh locks actions and ignores repeated clicks until its saved snapshot arrives',async({page,request})=>{
  const f=await savedShop(page,request);let hold=false,reads=0,writes=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('https://example.supabase.co/functions/v1/game-api/**',async r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state') {reads++;const snapshot=structuredClone(f.state);if(hold)await gate;return r.fulfill({json:snapshot});}
    writes++;return r.abort();
  });
  try {
    await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
    await page.getByRole('button',{name:'Cauldron',exact:true}).click();
    hold=true;const before=reads;
    await page.locator('#refresh').evaluate((b:HTMLButtonElement)=>{b.click();b.click();});
    await expect(page.locator('#brew-healing_tonic')).toBeDisabled({timeout:1500});
    await expect(page.locator('#refresh')).toBeDisabled();expect(reads).toBe(before+1);expect(writes).toBe(0);
    release();await expect(page.locator('#refresh')).toBeEnabled();await expect(page.locator('#brew-healing_tonic')).toBeEnabled();
    expect(writes).toBe(0);
  } finally {release();}
});

test('server pending journal survives twenty simulated offline minutes and reload without another action',async({page,request})=>{
  const f=await savedShop(page,request);let writes=0,ready=false;let requestId='';
  await page.clock.install();
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state')return r.fulfill({json:f.state});
    if(path==='/action') {
      writes++;requestId=r.request().postDataJSON().request_id;
      f.state.pending_operation={request_id:requestId,status:'pending'};return r.abort('connectionreset');
    }
    expect(path).toBe('/actions/'+requestId);
    if(!ready)return r.fulfill({status:503,json:{error:'Receipt service is unavailable.'}});
    f.brew();f.state.pending_operation=null;
    return r.fulfill({json:{status:'confirmed',result:{hash:'same-pending-brew'},error:null}});
  });
  await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await page.locator('#brew-healing_tonic').click();
  await expect(page.locator('#action-status')).toContainText('Refresh ledger');
  await page.clock.fastForward(20*60*1000);
  await page.evaluate(()=>sessionStorage.removeItem('copper-acorn.pending'));
  await page.reload();await expect(page.locator('#action-status')).toContainText('Receipt service is unavailable');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await expect(page.locator('#brew-healing_tonic')).toBeDisabled();
  ready=true;await page.locator('#refresh').click();
  await expect(page.locator('#copper')).toHaveText('39');await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('1');
  await expect(page.locator('#brew-healing_tonic')).toBeEnabled();expect(writes).toBe(1);
});

test('damaged or foreign browser pending data cannot post malformed or cross-world actions',async({page,request})=>{
  const f=await savedShop(page,request);let writes=0;
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state')return r.fulfill({json:f.state});
    writes++;return r.fulfill({status:400,json:{error:'No malformed request should be sent.'}});
  });
  await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
  for(const value of ['{damaged',JSON.stringify({world_id:f.world,request_id:null})]) {
    await page.evaluate(value=>sessionStorage.setItem('copper-acorn.pending',value),value);
    await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();
    await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
    await expect(page.locator('#copper')).toHaveText('40');expect(writes).toBe(0);
  }
  const foreign=JSON.stringify({world_id:crypto.randomUUID(),request_id:crypto.randomUUID(),action:{kind:'brew',token_id:'healing_tonic'}});
  await page.evaluate(value=>sessionStorage.setItem('copper-acorn.pending',value),foreign);
  await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeEnabled();
  expect(await page.evaluate(()=>sessionStorage.getItem('copper-acorn.pending'))).toBe(foreign);expect(writes).toBe(0);
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await expect(page.locator('#brew-healing_tonic')).toBeEnabled();
});

test('request lost before journaling retries only the original ID after login restoration',async({page,request})=>{
  const f=await savedShop(page,request);const bodies:any[]=[];let commits=0,recorded=false;
  await page.route('https://example.supabase.co/functions/v1/game-session',async r=>{await new Promise(resolve=>setTimeout(resolve,100));await r.fallback();});
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state')return r.fulfill({json:f.state});
    if(path.startsWith('/actions/'))return r.fulfill({status:404,json:{error:'Action was not recorded.'}});
    expect(path).toBe('/action');bodies.push(r.request().postDataJSON());
    if(bodies.length===1)return r.abort('connectionreset');
    expect(bodies[1]).toEqual(bodies[0]);
    if(!recorded){recorded=true;commits++;f.brew();}
    return r.fulfill({json:{status:'confirmed',result:{hash:'original-request-once'},error:null}});
  });
  await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await page.locator('#brew-healing_tonic').click();
  await expect(page.locator('#action-status')).toContainText('Refresh ledger');
  await page.reload();await expect(page.locator('#network-label')).toContainText('Saved shop');
  await expect(page.locator('#copper')).toHaveText('39');await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('1');
  await page.reload();await expect(page.locator('#copper')).toHaveText('39');
  expect(bodies).toHaveLength(2);expect(commits).toBe(1);
  expect(await page.evaluate(()=>sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
});

test('late saved snapshot cannot restore stock or controls after sign-out',async({page,request})=>{
  const f=await savedShop(page,request);let hold=false,writes=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('https://example.supabase.co/functions/v1/game-api/**',async r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state'){if(hold)await gate;return r.fulfill({json:f.state});}
    if(path==='/saves')return r.fulfill({json:{saves:[],limit:2}});
    writes++;return r.abort();
  });
  try {
    await page.goto('/');await expect(page.locator('#network-label')).toContainText('Saved shop');
    hold=true;await page.locator('#refresh').click();await expect(page.locator('#refresh')).toBeDisabled();
    await page.evaluate(()=>sessionStorage.setItem('test-signed-out','true'));
    await openAccount(page);await page.getByRole('button',{name:'Sign out',exact:true}).click();
    await expect(page.locator('#copper')).toHaveText('—');release();await page.locator('#close-games').click();
    await expect(page.locator('#refresh')).toBeEnabled();await page.locator('#refresh').click();
    await expect(page.locator('#action-status')).toContainText('Sign in');
    await expect(page.locator('[data-owned="healing_tonic"]')).toHaveCount(0);
    await expect(page.locator('#market-clock')).toBeHidden();await expect(page.locator('#rescue')).toBeHidden();
    await expect(page.locator('#refill')).toBeDisabled();await expect(page.locator('#mana-label')).toHaveText('—');
    expect(writes).toBe(0);
  }finally{release();}
});

test('a failed saved action without a receipt restores stock and keeps its failure message',async({page,request})=>{
  const f=await savedShop(page,request),id=crypto.randomUUID();let writes=0;
  f.state.pending_operation={request_id:id,status:'pending'};
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const path=new URL(r.request().url()).pathname.split('/game-api')[1];
    if(path==='/state')return r.fulfill({json:f.state});
    if(path==='/actions/'+id) {
      f.state.pending_operation=null;
      return r.fulfill({json:{status:'failed',result:null,error:'The recipe was rejected. No ingredients were consumed.'}});
    }
    writes++;return r.abort();
  });
  await page.goto('/');await expect(page.locator('#action-status')).toContainText('recipe was rejected');
  await expect(page.locator('#copper')).toHaveText('40');await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('0');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await expect(page.locator('#brew-healing_tonic')).toBeEnabled();
  expect(writes).toBe(0);
});
