import {test,expect,type Page} from '@playwright/test';
import {spawn} from 'node:child_process';
import {createServer as createNetServer,type AddressInfo} from 'node:net';
import {createServer as createViteServer} from 'vite';
import {resolve} from 'node:path';
import {rm,mkdir} from 'node:fs/promises';
import {WORLD,spots,ARENA_GATE,ACTOR} from '../src/isometric-layout';
import {ARENA} from '../src/arena-layout';
import {path,distance,sight,type Duel,type Cell} from '../../backend/combat.ts';

async function freePort(){const s=createNetServer();return new Promise<number>(resolve=>s.listen(0,'127.0.0.1',()=>{const p=(s.address() as AddressInfo).port;s.close(()=>resolve(p));}));}

test('two saved alchemists challenge, move, cast, resume and finish without changing either shop',async({browser,request})=>{
  test.setTimeout(180_000);
  const apiPort=await freePort(),webPort=await freePort(),base=`http://127.0.0.1:${webPort}`,file=resolve(`.local/arena-${apiPort}.json`);
  const api=spawn(resolve('target/debug/game-api'),[],{env:{...process.env,GAME_API_PORT:String(apiPort)},stdio:'ignore'});
  const values={GAME_API_PORT:String(apiPort),VITE_PUBLIC_LOCAL_ART:process.env.VITE_PUBLIC_LOCAL_ART||'false',VITE_PUBLIC_LOCAL_SANDBOX:'true',VITE_PUBLIC_SUPABASE_URL:'',VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY:''};
  const previous=Object.fromEntries(Object.keys(values).map(key=>[key,process.env[key]]));
  const contexts=await Promise.all([browser.newContext({recordVideo:{dir:'.local/arena-polish/videos',size:{width:1280,height:900}}}),browser.newContext()]),pages=await Promise.all(contexts.map(c=>c.newPage()));
  let server:Awaited<ReturnType<typeof createViteServer>>|undefined;
  const errors:string[]=[];for(const p of pages)p.on('pageerror',e=>errors.push(e.message));
  try{
    await expect.poll(async()=>{try{return(await fetch(`http://127.0.0.1:${apiPort}/api/state`)).status;}catch{return 0;}},{timeout:30_000}).toBe(200);
    Object.assign(process.env,values);server=await createViteServer({configFile:resolve('vite.config.ts'),server:{port:webPort,strictPort:true},logLevel:'silent'});await server.listen();
    const enter=async(p:Page)=>{
      if(p.url().endsWith('#arena')){await expect(p.locator('#arena-dialog')).toBeVisible();return;}
      const canvas=p.locator('#game canvas');await expect(canvas).toBeVisible();const bounds=(await canvas.boundingBox())!,portal=spots.find(s=>s.kind==='arena')!;
      await canvas.click({position:{x:portal.at[0]*bounds.width/WORLD.width,y:portal.at[1]*bounds.height/WORLD.height}});await expect(p.locator('#arena-dialog')).toBeVisible();
    };
    const post=async(p:Page,click:()=>Promise<unknown>)=>{
      const [r]=await Promise.all([p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='POST',{timeout:15000}),Promise.resolve().then(click)]);expect(r.status()).toBe(200);await expect(p.locator('#arena-status')).toBeEmpty();return r.json();
    };
    const worlds:string[]=[];expect(ARENA_GATE.height).toBeGreaterThan(ACTOR.height*ACTOR.scale);
    await mkdir('.local/arena-polish',{recursive:true});
    for(const [i,p] of pages.entries()){
      let arenaRequests=0;p.on('request',r=>{if(r.url().includes('/api/arena?'))arenaRequests++;});
      await p.goto(base);await expect(p.locator('#games-dialog')).toBeVisible();await p.locator('#new-game').click();
      await expect(p.locator('#character-dialog')).toBeVisible();await p.locator('#nickname').fill(i?'Bram':'Ada');
      await p.getByRole('radio',{name:i?'Lizardman':'Goblin',exact:true}).check();await p.locator('#use-character').click();
      await expect(p.locator('#character-dialog')).not.toBeVisible();await expect(p.locator('#character-name')).toContainText(i?'Bram':'Ada');await expect(p.locator('#open-arena')).toHaveCount(0);
      const portalPixels=await p.locator('#game canvas').evaluate(el=>{const pixels=(el as HTMLCanvasElement).getContext('2d')!.getImageData(845,815,80,100).data;let count=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>pixels[i]+25&&pixels[i+2]>pixels[i]+25&&pixels[i+1]>80)count++;return count;});expect(portalPixels).toBeGreaterThan(500);
      if(i===0)await p.locator('#game canvas').screenshot({path:'.local/duel-implementation/portal-town.png'});
      // Opening the arena is the first request: no combat profile is allocated during shop startup.
      expect(arenaRequests).toBe(0);
      const opened=p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='GET');await enter(p);
      await expect(p).toHaveURL(/#arena$/);await expect(p.getByRole('region',{name:'Arena courtyard map'})).toBeVisible();await expect(p.locator('#game canvas')).not.toBeVisible();
      const response=await opened,state=await response.json();expect(response.status(),JSON.stringify(state)).toBe(200);worlds.push(state.profile.id);await expect(p.locator('.arena-profile')).toContainText(i?'Bram':'Ada');
    }
    expect(worlds[0]).not.toBe(worlds[1]);
    const shop=async(id:string)=>(await request.get(base+'/api/state?world_id='+id)).json();
    const before=await Promise.all(worlds.map(shop));
    const snapshot=async(i=0)=>(await request.get(base+'/api/arena?world_id='+worlds[i])).json();
    const p=pages[0];
    await expect(p.locator('.arena-world')).toHaveCSS('background-image',/arena-map-night-calm.png/);
    await expect(p.locator('.arena-spectator.seated')).toHaveCount(8);
    for(const seat of await p.locator('.arena-spectator .arena-portrait').all())await expect(seat).toHaveCSS('background-image',/arena-spectators.png/);
    await expect(p.locator('.arena-flame[data-frames="12"]')).toHaveCount(2);
    await expect(p.locator('.arena-scenery')).not.toHaveAttribute('data-fire-error','true');
    for(const flame of await p.locator('.arena-flame').all()){
      const atlas=await flame.evaluate(async el=>{
        const image=new Image();image.src=(el as HTMLElement).style.backgroundImage.slice(5,-2);await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const c=canvas.getContext('2d')!;c.drawImage(image,0,0);
        const frames=new Set<string>();let hot=0;
        for(let f=0;f<12;f++){const pixels=c.getImageData(f*66,0,66,90).data;frames.add(String(pixels));for(let i=0;i<pixels.length;i+=4)if(pixels[i]>230&&pixels[i+1]>185&&pixels[i+2]>150&&pixels[i+3])hot++;}
        return {width:image.width,height:image.height,frames:frames.size,hot};
      });
      expect(atlas.width).toBe(792);expect(atlas.height).toBe(90);expect(atlas.frames).toBe(12);expect(atlas.hot,'white-hot flame cores stay opaque').toBeGreaterThan(50);
    }
    await expect(p.locator('.arena-scenery')).toHaveAttribute('aria-hidden','true');
    expect(await p.locator('.arena-scenery').evaluate(el=>el.querySelectorAll('button,a,[tabindex]').length)).toBe(0);
    expect(await p.locator('.arena-scenery').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
    await p.emulateMedia({reducedMotion:'no-preference'});
    const flame=p.locator('.arena-flame').first(),glow=p.locator('.arena-lantern-glow').nth(2);
    const flameFrame=await flame.screenshot({animations:'allow'}),glowFrame=await glow.screenshot({animations:'allow'});
    await p.waitForTimeout(375);
    expect((await flame.screenshot({animations:'allow'})).equals(flameFrame),'painted flame visibly changes').toBe(false);
    expect((await glow.screenshot({animations:'allow'})).equals(glowFrame),'lantern glow visibly changes').toBe(false);
    await p.locator('.arena-scenery').evaluate(el=>{(window as any).__arenaScenery=el;(window as any).__arenaFire=el.querySelector('.arena-flame')!.getAnimations()[0];});
    await p.waitForTimeout(1700);
    expect(await p.locator('.arena-scenery').evaluate(el=>el===(window as any).__arenaScenery&&el.querySelector('.arena-flame')!.getAnimations()[0]===(window as any).__arenaFire),'polling retains ambience and animation timeline').toBe(true);
    await p.screenshot({path:'.local/arena-night/courtyard.png'});
    await p.emulateMedia({reducedMotion:'reduce'});
    expect(await p.locator('.arena-scenery').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
    await expect(p.getByText('Training chicken',{exact:true})).toHaveCount(0);
    const relativeSize=await p.evaluate(()=>({chicken:document.querySelector('[data-person=trainer]')!.getBoundingClientRect().height,character:document.querySelector('.arena-world-person.self')!.getBoundingClientRect().height,portal:document.querySelector('.arena-return')!.getBoundingClientRect().height}));
    expect(relativeSize.chicken).toBeLessThan(relativeSize.character*.7);expect(relativeSize.portal).toBeGreaterThan(relativeSize.character*1.5);
    await expect(p.locator('[data-person="trainer"] .arena-chicken')).toHaveCSS('background-image',/training-chicken.png/);
    const room=p.getByRole('region',{name:'Arena courtyard map'});await expect(room).toBeVisible();const roomBox=await room.evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
    // A pending request and its confirmation must not move or replace the map.
    const stableAction=async(selector:string,click:()=>Promise<unknown>,during?:()=>Promise<void>)=>{
      await p.route('**/api/arena?**',async route=>{if(route.request().method()==='POST')await new Promise(resolve=>setTimeout(resolve,250));await route.continue();});
      await p.evaluate(selector=>{
        const el=document.querySelector<HTMLElement>(selector)!,box=el.getBoundingClientRect();
        const state={el,x:box.x,y:box.y,width:box.width,height:box.height,max:0,same:true,running:true,shifts:[] as unknown[]};
        (window as any).__arenaStability=state;
        function sample(){const now=el.getBoundingClientRect();state.same&&=el.isConnected;const delta=Math.max(Math.abs(now.x-state.x),Math.abs(now.y-state.y),Math.abs(now.width-state.width),Math.abs(now.height-state.height));if(delta>state.max)state.shifts.push({from:[state.x,state.y,state.width,state.height],to:[now.x,now.y,now.width,now.height],scroll:document.querySelector('#arena-dialog')!.scrollTop,status:getComputedStyle(document.querySelector('#arena-status')!).position});state.max=Math.max(state.max,delta);if(state.running)requestAnimationFrame(sample);}sample();
      },selector);
      const result=await post(p,click);if(during)await during();else await p.waitForTimeout(1200);
      const motion=await p.evaluate(()=>{const s=(window as any).__arenaStability;s.running=false;return {max:s.max,same:s.same,shifts:s.shifts};});
      await p.unroute('**/api/arena?**');expect(motion.same,'scene stays mounted').toBe(true);expect(motion.max,JSON.stringify(motion.shifts)).toBeLessThan(.5);return result;
    };
    const walked=await stableAction('[data-walkmap]',()=>room.click({position:{x:1000/1536*roomBox.width,y:480/1024*roomBox.height}})),chosenFloor=walked.profile.position;
    expect(Math.abs(chosenFloor[0]-1000)).toBeLessThan(2);expect(Math.abs(chosenFloor[1]-480)).toBeLessThan(2);
    await expect.poll(async()=>(await snapshot(1)).players.find((v:any)=>v.id===worlds[0]).position).toEqual(chosenFloor);
    await expect.poll(async()=>pages[1].locator(`[data-room-unit="${worlds[0]}"]`).evaluate((el,x)=>Math.abs(parseFloat((el as HTMLElement).style.left)/100*1536-x),chosenFloor[0])).toBeLessThan(1);
    await p.screenshot({path:'.local/arena-world/gathering-map.png'});
    await post(p,()=>room.press('ArrowRight'));expect((await snapshot()).profile.position).toEqual([chosenFloor[0]+24,chosenFloor[1]]);
    await p.locator('[data-person="trainer"]').click();await expect(p.locator('.arena-bubble')).toBeVisible();
    await p.locator('[data-cancel-fight]').click();await expect(p.locator('.arena-bubble')).toHaveCount(0);expect((await snapshot()).match).toBeNull();
    await p.locator('[data-person="trainer"]').click();await p.screenshot({path:'.local/duel-implementation/trainer-bubble.png',fullPage:true});
    const lobbyView=await room.evaluate(el=>{(window as any).__arenaScene=el;const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {x:b.x,y:b.y,width:b.width,height:b.height,background:s.backgroundImage,size:s.backgroundSize};});
    let practice=(await post(p,()=>p.locator('[data-fight="trainer"]').click())).match as Duel;
    await expect(p.locator('[data-return]')).toHaveCount(0);await expect(p.locator('#arena-close')).toBeDisabled();
    await p.getByRole('img',{name:'Portal sealed during combat'}).click();await p.keyboard.press('Escape');
    await expect(p.locator('#arena-dialog')).toBeVisible();expect((await snapshot()).match.version).toBe(practice.version);
    const fightView=await p.locator('.arena-board').evaluate(el=>{const b=el.getBoundingClientRect(),s=getComputedStyle(el);return {same:el===(window as any).__arenaScene,x:b.x,y:b.y,width:b.width,height:b.height,background:s.backgroundImage,size:s.backgroundSize};});
    expect(fightView.same).toBe(true);const {same,...geometry}=fightView;expect(geometry).toEqual(lobbyView);
    expect(await p.locator('.arena-scenery').evaluate(el=>el===(window as any).__arenaScenery),'same spectators and lights in combat').toBe(true);
    await expect(p.locator('.arena-cell.wall')).toHaveCount(0);expect(await p.getByRole('gridcell').count()).toBeGreaterThan(49);
    await p.locator('[data-cell="6,-1"]').hover();
    const hoverColor=await p.locator('[data-cell="6,-1"]').evaluate(el=>getComputedStyle(el).backgroundColor);expect(hoverColor).toMatch(/^rgba\(/);
    await p.screenshot({path:'.local/arena-floor/full-arena.png'});
expect(practice.training).toBe(true);
    let heldRead=false;
    await p.route('**/api/arena?**',async route=>{if(route.request().method()==='GET'&&!heldRead){heldRead=true;await new Promise(resolve=>setTimeout(resolve,350));}await route.continue();});
    await p.waitForRequest(r=>r.url().includes('/api/arena?')&&r.method()==='GET');
    const beforeQueuedEnd=practice.version;
    practice=(await post(p,()=>p.locator('#arena-end').click())).match;
    expect(practice.version).toBeGreaterThan(beforeQueuedEnd);await p.unroute('**/api/arena?**');
    await expect(p.locator('.arena-skills button')).toHaveCount(3);for(const icon of await p.locator('.arena-skills button').all()){const b=(await icon.boundingBox())!;expect(b.width).toBeLessThan(80);expect(b.height).toBeLessThan(90);await expect(icon.locator('.skill-art')).toHaveCSS('background-image',/skills.png/);}
    await p.locator('#arena-book').click();await expect(p.locator('#arena-spellbook')).toContainText('Poison for 4');await p.screenshot({path:'.local/duel-implementation/spellbook.png',fullPage:true});
    await p.keyboard.press('Escape');await expect(p.locator('#arena-spellbook')).not.toBeVisible();
    practice=(await stableAction('.arena-board',()=>p.locator('[data-cell="3,2"]').click())).match;
    practice=(await post(p,()=>p.locator('#arena-end').click())).match;expect(practice.active).toBe(0);expect(practice.players[0].hp).toBe(100);
    practice=(await post(p,()=>p.locator('[data-cell="4,3"]').click())).match;
    await p.emulateMedia({reducedMotion:'reduce'});await expect(p.locator('#arena-motion')).toHaveText('Animations: Reduced');await p.locator('#arena-motion').click();await expect(p.locator('#arena-motion')).toHaveText('Animations: Full');
    await p.locator('[data-skill="shiv"]').click();
    let targetingReads=0;const countTargetingRead=(r:any)=>{if(r.url().includes('/api/arena?')&&r.method()==='GET')targetingReads++;};p.on('request',countTargetingRead);
    await p.waitForTimeout(1600);p.off('request',countTargetingRead);expect(targetingReads).toBe(0);
    practice=(await stableAction('.arena-board',()=>p.locator('[data-cell="5,3"]').click(),async()=>{
    await expect(p.locator('#arena-dialog')).toHaveAttribute('data-attacking','shiv');await expect(p.locator('.arena-actor.casting')).toHaveCSS('background-image',/goblin-tap.png/);
    await expect(p.locator('.combat-number.damage')).toHaveText('−16');
    await p.waitForFunction(()=>{const actor=document.querySelector('.arena-actor.casting');return actor?.getAnimations().some(a=>Number(a.currentTime)>150);});
    await p.screenshot({path:'.local/arena-world/attack-frame.png'});await expect(p.locator('.combat-effects')).toHaveCount(0);
    })).match;
    await p.locator('#arena-motion').click();await expect(p.locator('#arena-motion')).toHaveText('Animations: Reduced');
    expect(practice.players[1].hp).toBe(84);practice=(await post(p,()=>p.locator('#arena-end').click())).match;expect(practice.players[1].hp).toBe(80);expect(practice.players[0].hp).toBe(100);
    await p.screenshot({path:'.local/duel-implementation/skill-hotbar.png',fullPage:true});
    for(let turn=0;turn<5&&!practice.result;turn++){
      for(let cast=0;cast<2&&!practice.result;cast++){
        await expect(p.locator('[data-skill="shiv"]')).toBeEnabled();await p.locator('[data-skill="shiv"]').click();practice=(await post(p,()=>p.locator('[data-cell="5,3"]').click())).match;
      }
      if(!practice.result)practice=(await post(p,()=>p.locator('#arena-end').click())).match;
    }
    expect(practice.result?.winner).toBe(worlds[0]);await expect(p.locator('.combat-effects')).toBeVisible();await expect(p.locator('.arena-result')).toHaveCount(0);
    await expect(room).toBeVisible();await expect(p.locator('.arena-board')).toHaveCount(0);await expect(p.locator('.arena-combat-bar')).toHaveCount(0);
    await expect(p.locator('.arena-result')).toHaveText('Training complete · No XP awarded');await expect(p.getByRole('button',{name:'Return portal to town'})).toBeEnabled();await expect(p.locator('#arena-lobby')).toHaveCount(0);
    expect((await snapshot()).profile.xp).toBe(0);expect((await snapshot()).profile.wins).toBe(0);await p.screenshot({path:'.local/arena-completion/training-return.png'});
    await expect(p.locator('.arena-result')).toHaveCount(0);await p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='GET');await expect(p.locator('.arena-result')).toHaveCount(0);await expect(room).toBeVisible();
    await p.locator('#arena-book').click();await p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='GET');await expect(p.locator('#arena-spellbook')).toBeVisible();await p.keyboard.press('Escape');
    await p.locator('[data-person="trainer"]').click();await p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='GET');await expect(p.locator('.arena-bubble')).toBeVisible();await p.locator('[data-cancel-fight]').click();
    await p.reload();await enter(p);await expect(room).toBeVisible();await expect(p.locator('.arena-board')).toHaveCount(0);await expect(p.locator('.arena-result')).toHaveCount(0);
    await p.locator('[data-person="trainer"]').click();await post(p,()=>p.locator('[data-fight="trainer"]').click());
    await expect(p.locator('#arena-close')).toBeDisabled();await post(p,()=>p.locator('#arena-stop').click());
    if((await p.locator('#arena-motion').innerText()).endsWith('Reduced'))await p.locator('#arena-motion').click();
    const moving=()=>p.locator('.arena-world-person.self');
    const travel=await post(p,()=>p.getByRole('button',{name:'Return portal to town'}).click());expect(travel.profile.position).toEqual(ARENA.exitApproach);
    await expect(p.locator('#arena-dialog')).toBeVisible();await expect(moving()).toHaveClass(/moving/);
    const distanceToGate=await moving().evaluate((el,goal)=>{const style=getComputedStyle(el),map=el.parentElement!;return Math.hypot(parseFloat(style.left)/map.clientWidth*1536-goal[0],parseFloat(style.top)/map.clientHeight*1024-goal[1]);},ARENA.exitApproach);expect(distanceToGate).toBeGreaterThan(10);
    await p.keyboard.press('Escape');await p.waitForTimeout(1900);await expect(p.locator('#arena-dialog')).toBeVisible();
    await post(p,()=>room.click({position:{x:1000/1536*roomBox.width,y:480/1024*roomBox.height}}));await expect(moving()).not.toHaveClass(/moving/);
    let delayedRead=false,reading=false,overlapped=false;
    await p.route('**/api/arena?**',async route=>{if(route.request().method()==='GET'&&!delayedRead){delayedRead=true;reading=true;await new Promise(resolve=>setTimeout(resolve,700));reading=false;}else if(route.request().method()==='POST'&&reading)overlapped=true;await route.continue();});
    await p.waitForRequest(r=>r.url().includes('/api/arena?')&&r.method()==='GET');
    await post(p,()=>p.getByRole('button',{name:'Return portal to town'}).click());expect(overlapped).toBe(false);await p.unroute('**/api/arena?**');await expect(moving()).toHaveClass(/moving/);
    await p.screenshot({path:'.local/arena-portal-travel/approaching.png'});await expect(p.locator('#arena-dialog')).not.toBeVisible();await expect(p).not.toHaveURL(/#arena$/);
    await enter(p);await expect(p.locator('#arena-dialog')).toBeVisible();await p.locator('#arena-motion').click();

    await p.setViewportSize({width:320,height:800});await p.locator(`[data-person="${worlds[1]}"]`).click();await expect(p.locator('.arena-bubble')).toBeVisible();
    expect(await p.locator('#arena-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    const bubble=(await p.locator('.arena-bubble').boundingBox())!,frame=(await p.locator('#arena-dialog').boundingBox())!;expect(bubble.x).toBeGreaterThanOrEqual(frame.x+16);expect(bubble.x+bubble.width).toBeLessThanOrEqual(frame.x+frame.width-16);
    await p.screenshot({path:'.local/duel-implementation/fight-bubble-mobile.png'});await p.setViewportSize({width:1440,height:1100});
    await post(p,()=>p.locator(`[data-fight="${worlds[1]}"]`).click());
    await expect(pages[1].getByRole('button',{name:'Accept duel'})).toBeVisible();
    await post(pages[1],()=>pages[1].getByRole('button',{name:'Accept duel'}).click());
    for(const p of pages)await expect(p.getByRole('grid',{name:'Duel arena, courtyard floor'})).toBeVisible();
    for(const p of pages){await expect(p.locator('#arena-close')).toBeDisabled();await expect(p.locator('[data-return]')).toHaveCount(0);}
    await p.getByRole('img',{name:'Portal sealed during combat'}).click();await p.keyboard.press('Escape');await expect(p.locator('#arena-dialog')).toBeVisible();
    let d:Duel=(await snapshot()).match;const deadline=d.deadline;
    await mkdir('.local/duel-implementation',{recursive:true});
    await pages[0].screenshot({path:'.local/duel-implementation/arena-desktop.png',fullPage:true});
    await pages[0].setViewportSize({width:320,height:800});
    expect(await pages[0].evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
    const cards=await pages[0].locator('.arena-fighters').boundingBox();expect(cards!.x).toBeGreaterThanOrEqual(0);expect(cards!.x+cards!.width).toBeLessThanOrEqual(320);
    expect(await pages[0].locator('#arena-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    await pages[0].screenshot({path:'.local/duel-implementation/arena-mobile.png'});await pages[0].setViewportSize({width:1440,height:1100});
    const focused=pages[0].locator('[data-cell="1,3"]');await focused.focus();await focused.press('ArrowRight');await expect(pages[0].locator('[data-cell="2,3"]')).toBeFocused();
    await pages[0].reload();await expect(pages[0].locator('#character-name')).toContainText('Ada');await enter(pages[0]);
    await expect(pages[0].getByRole('grid')).toBeVisible();expect((await snapshot()).match.deadline).toBe(deadline);
    let moves=0,casts=0;
    for(let turn=0;turn<35&&!d.result;turn++){
      const actor=d.players[d.active],opponent=d.players[1-d.active],p=pages[worlds.indexOf(actor.id)];
      await expect(p.locator('#arena-end')).toBeEnabled();
      if(distance(actor.pos,opponent.pos)>1){
        const adjacent:Cell[]=[{x:opponent.pos.x+1,y:opponent.pos.y},{x:opponent.pos.x-1,y:opponent.pos.y},{x:opponent.pos.x,y:opponent.pos.y+1},{x:opponent.pos.x,y:opponent.pos.y-1}];
        const route=adjacent.map(c=>path(d,actor.pos,c,actor.id)).filter((p):p is Cell[]=>!!p?.length).sort((a,b)=>a.length-b.length)[0];
        if(route){const c=route[Math.min(actor.mp,route.length)-1];const r=await post(p,()=>p.locator(`[data-cell="${c.x},${c.y}"]`).click());d=r.match;moves++;}
      }
      for(let cast=0;cast<2&&!d.result;cast++){
        const a=d.players[d.active],b=d.players[1-d.active];if(distance(a.pos,b.pos)!==1||!sight(a.pos,b.pos))break;
        const skill=a.character==='goblin'?'shiv':'scale';await p.locator(`[data-skill="${skill}"]`).click();
        await expect(p.locator(`[data-skill="${skill}"]`)).toHaveAttribute('aria-pressed','true');
        const spectator=pages[1-worlds.indexOf(a.id)],visibleToPeer=casts===0?spectator.waitForSelector(`#arena-dialog[data-attacking="${skill}"]`,{timeout:10000}):null;
        const r=await post(p,()=>p.locator(`[data-cell="${b.pos.x},${b.pos.y}"]`).click());d=r.match;casts++;if(visibleToPeer)await visibleToPeer;
      }
      if(!d.result){d=(await post(p,()=>p.locator('#arena-end').click())).match;}
    }
    expect(moves).toBeGreaterThan(0);expect(casts).toBeGreaterThan(3);expect(d.result?.winner).toBeTruthy();
    const winner=worlds.indexOf(d.result!.winner!),loser=1-winner;
    for(const page of pages){await expect(page.getByRole('region',{name:'Arena courtyard map'})).toBeVisible();await expect(page.locator('.arena-board')).toHaveCount(0);await expect(page.locator('.arena-combat-bar')).toHaveCount(0);await expect(page.locator('#arena-lobby')).toHaveCount(0);}
    await expect(pages[winner].locator('.arena-result')).toHaveText('Victory');await expect(pages[loser].locator('.arena-result')).toHaveText('Defeat');
    expect((await snapshot(winner)).profile.xp).toBe(20);expect((await snapshot(loser)).profile.xp).toBe(0);
    const after=await Promise.all(worlds.map(shop));
    for(let i=0;i<2;i++){expect(after[i].player).toEqual(before[i].player);expect(after[i].shop).toEqual(before[i].shop);expect(after[i].alchemist).toEqual(before[i].alchemist);}
    await pages[winner].screenshot({path:'.local/duel-implementation/arena-victory.png',fullPage:true});
    await pages[winner].reload();await enter(pages[winner]);await expect(pages[winner].getByRole('region',{name:'Arena courtyard map'})).toBeVisible();await expect(pages[winner].locator('.arena-result')).toHaveCount(0);expect((await snapshot(winner)).profile.xp).toBe(20);
    let failTravel=true;
    await p.route('**/api/arena?**',async route=>{if(failTravel&&route.request().method()==='POST'&&route.request().postDataJSON().kind==='walk'){failTravel=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Simulated uncertain travel'})});}else await route.continue();});
    const rejected=p.waitForResponse(r=>r.url().includes('/api/arena?')&&r.request().method()==='POST');await p.locator('#arena-close').click();expect((await rejected).status()).toBe(503);
    await expect(p.locator('#arena-retry')).toBeVisible();await p.waitForTimeout(450);await expect(p.locator('#arena-dialog')).toBeVisible();
    const saved=await p.evaluate(world=>JSON.parse(localStorage.getItem('copper-acorn.arena-pending:'+world)!),worlds[0]),retryRequest=p.waitForRequest(r=>r.url().includes('/api/arena?')&&r.method()==='POST');
    await post(p,()=>p.locator('#arena-retry').click());expect((await retryRequest).postDataJSON()).toEqual(saved);await expect(p.locator('#arena-dialog')).not.toBeVisible();
    expect(errors).toEqual([]);
  }finally{
    await Promise.allSettled(contexts.map(c=>c.close()));await server?.close();api.kill('SIGTERM');await new Promise<void>(resolve=>{if(api.exitCode!==null)resolve();else api.once('exit',()=>resolve());});await rm(file,{force:true});
    for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  }
});
