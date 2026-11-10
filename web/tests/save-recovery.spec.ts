import {test,expect,type Page,type APIRequestContext} from '@playwright/test';

const old='20000000-0000-4000-8000-000000000001',fresh='20000000-0000-4000-8000-000000000002';
async function hostedPreview(page:Page,request:APIRequestContext,pending=false){
  const source=await(await request.get('/api/state')).json(),owner='10000000-0000-4000-8000-000000000001';
  const user={id:owner,aud:'authenticated',role:'authenticated',user_metadata:{character_id:'elf'}},expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:owner,exp:expires,role:'authenticated'})).toString('base64url'),'simulated'].join('.');
  await page.addInitScript(({token,expires,user})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{token,expires,user});
  let active=old;const selections:unknown[]=[];
  await page.route('https://example.supabase.co/**',async route=>{
    const r=route.request(),url=new URL(r.url()),displayed=url.searchParams.get('world_id')||new URL(page.url()).searchParams.get('world_id')||fresh;
    if(r.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}});
    let body:unknown;
    if(url.pathname==='/auth/v1/user')body=user;
    else if(url.pathname.endsWith('/game-session'))body={world:{id:displayed,status:'ready',is_active:displayed===active},wallet:{account_id:'ca-'+displayed.replaceAll('-','')+'.testnet',funded_at:'2026-11-07T00:00:00Z'}};
    else if(url.pathname.endsWith('/game-api/state')){
      const state=structuredClone(source);Object.assign(state.environment,{network:'testnet',world_id:displayed,is_active:displayed===active});
      state.player.account_id='ca-'+displayed.replaceAll('-','')+'.testnet';state.alchemist={nickname:displayed===fresh?'New Apprentice':'Old Keeper',character_id:displayed===fresh?'elf':'goblin'};
      state.pending_operation=pending?{request_id:'pending-save-transaction',status:'pending'}:null;body=state;
    }else if(url.pathname.endsWith('/game-api/saves'))body={saves:[{world_id:old,is_active:active===old,alchemist:{nickname:'Old Keeper',character_id:'goblin'}},{world_id:fresh,is_active:active===fresh,alchemist:{nickname:'New Apprentice',character_id:'elf'}}],limit:2,active_world_id:active};
    else if(url.pathname.endsWith('/game-api/actions/pending-save-transaction'))body={status:'pending',result:null,error:null};
    else if(url.pathname.endsWith('/game-api/select-save')){const selected=r.postDataJSON();selections.push(selected);active=selected.target_id;body={world_id:active};}
    else return route.fulfill({status:400,json:{error:'Unexpected request in save fixture'}});
    return route.fulfill({json:body,headers:{'access-control-allow-origin':'*'}});
  });
  await page.goto('/?world_id='+fresh);await expect(page.locator('#network-label')).toContainText('Shop preview');
  if(!await page.locator('#games-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.getByRole('button',{name:'Saved games',exact:true}).click();
  await expect(page.locator('#save-list [data-save]')).toHaveCount(2);
  return selections;
}

for(const [target,name] of [[fresh,'New Apprentice'],[old,'Old Keeper']])test(`an inactive hosted preview can select ${name} with the expected active save`,async({page,request})=>{
  try{
    const selections=await hostedPreview(page,request);
    await expect(page.locator(`#save-list [data-save="${fresh}"]`)).toBeEnabled();await expect(page.locator(`#save-list [data-save="${old}"]`)).toBeEnabled();
    await page.locator(`#save-list [data-save="${target}"]`).click();
    await expect(page.locator('#network-label')).toContainText('Saved shop');
    await expect(page.locator('#character-name')).toContainText(name);
    expect(selections).toEqual([{world_id:fresh,target_id:target,expected_active:old}]);
  }finally{await page.unrouteAll({behavior:'wait'});}
});

test('pending hosted transactions still block save activation in a preview',async({page,request})=>{
  try{
    const selections=await hostedPreview(page,request,true);
    await expect(page.locator(`#save-list [data-save="${fresh}"]`)).toBeDisabled();await expect(page.locator(`#save-list [data-save="${old}"]`)).toBeDisabled();
    expect(selections).toEqual([]);
  }finally{await page.unrouteAll({behavior:'wait'});}
});

for(const status of [404,503])test(`a local selected-world ${status} ${status===404?'allows explicit recovery':'keeps pending safeguards'}`,async({page,request})=>{
  const state=await(await request.get('/api/state')).json(),missing='sandbox-missing-save',available=state.environment.world_id;
  state.alchemist={nickname:'Available Keeper',character_id:'goblin'};state.pending_operation=null;
  const pending={world_id:missing,request_id:'pending-missing-save',action:{kind:'gather',token_id:'sunleaf'}};
  await page.addInitScript(({missing,pending})=>{sessionStorage.setItem('copper-acorn.local-world',missing);sessionStorage.setItem('copper-acorn.pending',JSON.stringify(pending));},{missing,pending});
  let posts=0;page.on('request',r=>{if(r.method()==='POST')posts++;});
  await page.route('**/api/saves',r=>r.fulfill({json:{saves:[{world_id:available,alchemist:state.alchemist}],limit:3}}));
  await page.route('**/api/state*',r=>new URL(r.request().url()).searchParams.get('world_id')===missing?r.fulfill({status,json:{error:status===404?'Save unavailable':'Local chain unavailable'}}):r.fulfill({json:state}));
  try{
    await page.goto('/');await expect(page.locator('#action-status')).toContainText(status===404?'Saved games':'Trading is paused');
    if(await page.locator('#character-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.locator('#cancel-character').click();
    if(!await page.locator('#games-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.getByRole('button',{name:'Saved games',exact:true}).click();
    const slot=page.locator(`#save-list [data-save="${available}"]`);
    if(status===404){await expect(slot).toBeEnabled();await slot.click();await expect(page.locator('#character-name')).toContainText('Available Keeper');await expect(page.locator('#copper')).toHaveText(state.player.balances.copper);}
    else await expect(slot).toBeDisabled();
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('copper-acorn.pending')!))).toEqual(pending);expect(posts).toBe(0);
  }finally{await page.unrouteAll({behavior:'wait'});}
});

test('a missing receipt in an existing local world does not unlock save switching',async({page,request})=>{
  const state=await(await request.get('/api/state')).json(),world=state.environment.world_id;
  const pending={world_id:world,request_id:'pending-existing-world',action:{kind:'gather',token_id:'sunleaf'}};
  state.alchemist={nickname:'Pending Keeper',character_id:'goblin'};state.pending_operation={request_id:pending.request_id,status:'pending'};
  await page.addInitScript(({world,pending})=>{sessionStorage.setItem('copper-acorn.local-world',world);sessionStorage.setItem('copper-acorn.pending',JSON.stringify(pending));},{world,pending});
  await page.route('**/api/state*',r=>r.fulfill({json:state}));
  await page.route('**/api/actions/**',r=>r.fulfill({status:404,json:{error:'Receipt unavailable'}}));
  await page.route('**/api/saves',r=>r.fulfill({json:{saves:[{world_id:'sandbox-another-world',alchemist:{nickname:'Other Keeper',character_id:'elf'}}],limit:3}}));
  try{
    await page.goto('/');await expect(page.locator('#action-status')).toContainText('Trading is paused');
    if(await page.locator('#character-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.locator('#cancel-character').click();
    if(!await page.locator('#games-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.getByRole('button',{name:'Saved games',exact:true}).click();await expect(page.locator('#save-list [data-save]')).toBeDisabled();
    expect(await page.evaluate(()=>JSON.parse(sessionStorage.getItem('copper-acorn.pending')!))).toEqual(pending);
  }finally{await page.unrouteAll({behavior:'wait'});}
});
