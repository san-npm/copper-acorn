import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {spots,WORLD} from '../src/isometric-layout';
import {path,distance,sight,type Cell,type Duel} from '../../backend/combat';

test('opening a player-owned shop shows progress and recovers a lost setup response without reloading or allocating twice',async({page,request})=>{
  const before=(await(await request.get('/api/saves')).json()).saves.length;
  const setupBodies:unknown[]=[],errors:string[]=[];let release=()=>{},arrived=()=>{};
  let lostArtwork=false;
  const held=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{arrived=resolve;});
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/owned/new-game',async route=>{
    setupBodies.push(route.request().postDataJSON());
    if(setupBodies.length===1){arrived();await held;await route.fetch();await route.abort();}
    else await route.continue();
  });
  await page.route('**/assets/characters/manifest.json',async route=>{if(!lostArtwork){lostArtwork=true;await route.abort();}else await route.continue();});
  try{
    await page.goto('/?owned=1',{waitUntil:'commit'});await started;
    await expect(page.locator('#games-dialog')).toBeVisible({timeout:3000});
    await expect(page.locator('#games-title')).toHaveText('Opening your shop');
    await expect(page.locator('#games-status')).toContainText('Preparing your shop');
    await expect(page.locator('#new-game')).not.toBeVisible();
    await page.setViewportSize({width:320,height:800});
    expect(await page.locator('#games-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
    await page.screenshot({path:'.local/owned-startup-mobile.png'});await page.setViewportSize({width:1440,height:1100});
    await page.keyboard.press('Escape');await expect(page.locator('#games-dialog')).toBeVisible();
    await page.screenshot({path:'.local/owned-startup-progress.png'});
    release();
    const retry=page.getByRole('button',{name:'Retry setup',exact:true});await expect(retry).toBeVisible();
    await expect(page.locator('#games-status')).toContainText('Your saved setup is kept');
    await page.evaluate(()=>{(window as any).__startupRetriedWithoutReload=true;});await retry.click();
    await expect(page.locator('#games-status')).toContainText('Loading character artwork');await expect(retry).toBeVisible();
    await page.screenshot({path:'.local/owned-startup-retry.png'});await retry.click();
    await expect(page.locator('#games-title')).toHaveText('Welcome to Copper Acorn');await expect(page.locator('#new-game')).toBeVisible();await expect(page.locator('#new-game')).toBeEnabled();
    expect(await page.evaluate(()=>(window as any).__startupRetriedWithoutReload)).toBe(true);
    expect(setupBodies).toHaveLength(2);expect(setupBodies[1]).toEqual(setupBodies[0]);
    expect((await(await request.get('/api/saves')).json()).saves).toHaveLength(before+1);
    await page.locator('#new-game').click();await page.locator('#nickname').fill('Moss');await page.getByRole('radio',{name:'Elf',exact:true}).check();await page.locator('#use-character').click();
    await expect(page.locator('#character-dialog')).not.toBeVisible();await expect(page.locator('#character-name')).toHaveText('Moss · Elf');
    expect(errors).toEqual([]);
  }finally{release();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('device-owned crafting, Mira memory, referee settlement and revocation use no backend player key',async({browser,request})=>{
  const contexts=await Promise.all([browser.newContext(),browser.newContext()]),pages=await Promise.all(contexts.map(c=>c.newPage()));
  const errors:string[]=[],sent:string[]=[];pages.forEach(p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(r.method()==='POST')sent.push(r.postData()||'');});});
  const worlds:string[]=[];
  const snapshot=async(i=0)=>(await request.get('/api/state?world_id='+worlds[i])).json();
  const arena=async(i:number,body?:object)=>pages[i].evaluate(async({world,body})=>{const r=await fetch('/api/arena?world_id='+world,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});const data=await r.json();if(!r.ok)throw Error(JSON.stringify(data));return data;},{world:worlds[i],body});
  const clickSpot=async(p:Page,id:string)=>{const bounds=(await p.locator('#game canvas').boundingBox())!,spot=spots.find(s=>id==='arena'?s.kind==='arena':s.id===id)!;await p.locator('#game canvas').click({position:{x:spot.at[0]*bounds.width/WORLD.width,y:spot.at[1]*bounds.height/WORLD.height}});};
  try{
    for(const [i,p] of pages.entries()){
      await p.goto('/?owned=1');await expect(p.locator('#games-dialog')).toBeVisible();await p.locator('#new-game').click();await expect(p.locator('#character-dialog')).toBeVisible();
      await p.locator('#nickname').fill(i?'Bryn':'Ada');await p.getByRole('radio',{name:i?'Lizardman':'Goblin',exact:true}).check();await p.locator('#use-character').click();await expect(p.locator('#character-dialog')).not.toBeVisible();
      worlds.push((await p.evaluate(()=>sessionStorage.getItem('copper-acorn.local-world')))!);
      await expect(p.locator('#character-name')).toContainText(i?'Bryn':'Ada');
    }
    const before=await snapshot();expect(before.environment.player_owned).toBe(true);expect(before.player.account_id).not.toBe((await snapshot(1)).player.account_id);
    // The contract and player key lists can be checked publicly; neither contains a backend player key.
    const keys=await request.post('/api/owned/rpc',{data:{world_id:worlds[0],method:'query',params:{request_type:'view_access_key_list',finality:'final',account_id:'game.owner.test.near'}}});expect((await keys.json()).result.keys).toEqual([]);
    const playerKeys=await request.post('/api/owned/rpc',{data:{world_id:worlds[0],method:'query',params:{request_type:'view_access_key_list',finality:'final',account_id:before.player.account_id}}});expect((await playerKeys.json()).result.keys).toHaveLength(2);
    const forbidden=await request.post('/api/action',{data:{world_id:worlds[0],request_id:crypto.randomUUID(),action:{kind:'gather',token_id:'moonmint'}}});expect(forbidden.status()).toBe(403);
    expect((await request.post('/api/owned/referee',{data:{method:'progress',args:{account_id:before.player.account_id}}})).status()).toBe(403);
    const p=pages[0];await p.getByRole('button',{name:'Cauldron',exact:true}).click();await p.locator('#brew-healing_tonic').click();await expect.poll(async()=>(await snapshot()).player.balances.healing_tonic).toBe('1');
    await p.getByRole('button',{name:'Shelves',exact:true}).click();await p.locator('#list').click();await expect.poll(async()=>(await snapshot()).listings.length).toBe(1);
    await p.getByRole('button',{name:'Customers',exact:true}).click();await p.locator('#serve').click();await expect.poll(async()=>(await snapshot()).player.balances.healing_tonic).toBe('0');
    await clickSpot(p,'mira');await expect(p.locator('.mira-conversation')).toBeVisible();await p.getByRole('button',{name:'Ingredient work',exact:true}).click();await expect(p.locator('.mira-order-actions button').first()).toHaveText('Accept order');
    await p.getByRole('button',{name:'Accept order',exact:true}).click();await expect(p.locator('.mira-order')).toContainText('accepted');
    const order=await p.evaluate(async world=>(await(await fetch('/api/owned/mira',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({world_id:world,method:'view'})})).json()).order,worlds[0]);
    await p.locator('#interaction-close').click();
    // Gather only the shortfall required by Mira's verified order.
    const held=Number((await snapshot()).player.balances[order.token_id]),needed=Number(order.amount)-held;
    if(needed>0){await clickSpot(p,order.token_id);await p.locator('#gather-amount').selectOption(String(needed));await p.locator('#interaction-confirm').click();await expect.poll(async()=>Number((await snapshot()).player.balances[order.token_id])).toBeGreaterThanOrEqual(Number(order.amount));}
    await clickSpot(p,'mira');await expect(p.getByRole('button',{name:'Deliver goods',exact:true})).toBeEnabled();await p.getByRole('button',{name:'Deliver goods',exact:true}).click();await expect(p.locator('.mira-order')).toContainText('1 delivery confirmed');
    await p.locator('#interaction-close').click();await p.reload();await expect(p.locator('#character-name')).toContainText('Ada');await clickSpot(p,'mira');await expect(p.locator('.mira-history')).toContainText('1 completed delivery');await p.screenshot({path:'.local/owned-results/mira.png'});await p.locator('#interaction-close').click();
    const ledgers=await Promise.all([snapshot(0),snapshot(1)]);
    for(let i=0;i<2;i++){await clickSpot(pages[i],'arena');await expect(pages[i].locator('#arena-dialog')).toBeVisible();await arena(i);}
    await arena(0,{kind:'challenge',target:worlds[1],request_id:crypto.randomUUID()});const invite=(await arena(1)).invitations[0];let d:Duel=(await arena(1,{kind:'accept',invite:invite.id,request_id:crypto.randomUUID()})).match;
    let casts=0;
    for(let turn=0;turn<35&&!d.result;turn++){
      const a=d.players[d.active],b=d.players[1-d.active],i=worlds.indexOf(a.id);
      const act=async(action:object)=>{d=(await arena(i,{kind:'act',match:d.id,version:d.version,action,request_id:crypto.randomUUID()})).match;};
      if(distance(a.pos,b.pos)>1){const adjacent:Cell[]=[{x:b.pos.x+1,y:b.pos.y},{x:b.pos.x-1,y:b.pos.y},{x:b.pos.x,y:b.pos.y+1},{x:b.pos.x,y:b.pos.y-1}];const route=adjacent.map(c=>path(d,a.pos,c,a.id)).filter((p):p is Cell[]=>!!p?.length).sort((a,b)=>a.length-b.length)[0];if(route)await act({kind:'move',...route[Math.min(a.mp,route.length)-1]});}
      for(let j=0;j<2&&!d.result;j++){const a=d.players[d.active],b=d.players[1-d.active];if(distance(a.pos,b.pos)!==1||!sight(a.pos,b.pos))break;await act({kind:'cast',skill:a.character==='goblin'?'shiv':'scale',target:b.id});casts++;}
      if(!d.result)await act({kind:'end'});
    }
    expect(casts).toBeGreaterThan(2);expect(d.result?.winner).toBeTruthy();
    await expect.poll(async()=>(await arena(0)).settlement?.status,{timeout:30_000}).toBe('confirmed');
    const record=(await arena(0)).settlement,win=worlds.indexOf(d.result!.winner!),lost=1-win;
    expect((await arena(win)).profile.xp).toBe(20);expect((await arena(lost)).profile.xp).toBe(0);
    for(let i=0;i<2;i++){const after=await snapshot(i);expect(after.player).toEqual(ledgers[i].player);await expect(pages[i].getByRole('region',{name:'Arena courtyard map'})).toBeVisible();}
    // Exercise the real chain idempotency rule with a repeated report, then reload the persisted receipt.
    const repeated=await request.post('/api/owned/referee',{headers:{Authorization:'Bearer local-preview-referee-no-real-assets'},data:{method:'settle_duel',args:{result:record.result}}});expect(repeated.status()).toBe(200);
    await pages[win].reload();await expect.poll(async()=>(await arena(win)).profile.wins).toBe(1);
    expect(JSON.parse(await readFile('.local/arena-3901.json','utf8')).settlements[d.id].status).toBe('confirmed');
    await pages[0].goto('/?owned=1');await expect(pages[0].locator('#character-name')).toContainText('Ada');
    const failedBefore=await snapshot();
    const invalid=await pages[0].evaluate(async({world,state})=>{const {localPlayerDevice}=await import('/src/player-device.ts');return localPlayerDevice('').action(world,crypto.randomUUID(),{kind:'brew',token_id:'restoration_elixir'},state);},{world:worlds[0],state:failedBefore});
    expect(invalid.status).toBe('failed');expect((await snapshot()).player).toEqual(failedBefore.player);expect((await snapshot()).game_session).toEqual(failedBefore.game_session);
    const lostId=crypto.randomUUID();let dropped=false;
    await pages[0].route('**/api/owned/rpc',async route=>{if(!dropped&&route.request().postDataJSON()?.method==='send_tx'){dropped=true;await route.fetch();await route.abort();}else await route.continue();});
    const uncertain=await pages[0].evaluate(async({world,state,id})=>{const {localPlayerDevice}=await import('/src/player-device.ts');return localPlayerDevice('').action(world,id,{kind:'gather',token_id:'sunleaf'},state);},{world:worlds[0],state:failedBefore,id:lostId});
    expect(uncertain.status).toBe('unconfirmed');await pages[0].unroute('**/api/owned/rpc');
    const recovered=await pages[0].evaluate(async({world,id})=>{const {localPlayerDevice}=await import('/src/player-device.ts');const device=localPlayerDevice('');return [await device.operation(world,id),await device.operation(world,id)];},{world:worlds[0],id:lostId});
    expect(recovered.map(o=>o.status)).toEqual(['confirmed','confirmed']);expect(recovered[0].result?.hash).toBe(uncertain.result?.hash);expect((await snapshot()).player.next_action).toBe(failedBefore.player.next_action+1);
    const refillBefore=await snapshot();
    const refill=await pages[0].evaluate(async({world,state})=>{const {localPlayerDevice}=await import('/src/player-device.ts');return localPlayerDevice('').action(world,crypto.randomUUID(),{kind:'refill'},state);},{world:worlds[0],state:refillBefore});
    expect(refill.status).toBe('confirmed');expect(BigInt((await snapshot()).player.balances.copper)).toBe(BigInt(refillBefore.player.balances.copper)-10n);expect(BigInt((await snapshot()).environment.native_balance)).toBeGreaterThan(BigInt(refillBefore.environment.native_balance));
    await pages[0].locator('#revoke-device').click();await expect(pages[0].locator('#action-status')).toContainText('Device access revoked');
    const revokedBefore=await snapshot();
    const rejected=await pages[0].evaluate(async({world,state})=>{const {localPlayerDevice}=await import('/src/player-device.ts');return localPlayerDevice('').action(world,crypto.randomUUID(),{kind:'gather',token_id:'sunleaf'},state);},{world:worlds[0],state:revokedBefore});
    expect(rejected.status).toBe('failed');expect((await snapshot()).player).toEqual(revokedBefore.player);
    expect(sent.some(s=>/"(private_key|secret_key|root|session)"\s*:/.test(s))).toBe(false);expect(errors).toEqual([]);
  }finally{await Promise.allSettled(contexts.map(c=>c.close()));}
});
