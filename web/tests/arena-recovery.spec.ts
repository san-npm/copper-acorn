import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {makeDuel} from '../../backend/combat.ts';
import {arenaStep,type Store} from '../../backend/arena-engine.ts';

for(const viewport of [{width:1440,height:900},{width:320,height:640}])test(`an old unconfirmed combat request can be recovered without trapping controls at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  const world=randomUUID(),profile={id:world,nickname:'Mage',character:'magician' as const,xp:0,wins:0,losses:0};
  const match=makeDuel(randomUUID(),[profile,{...profile,id:'trainer-'+world,nickname:'Captain Cluck'}],Date.now(),0);match.training=true;match.players[0].ap=2;match.players[0].mp=0;
  let store:Store={version:1,profiles:{[world]:profile},matches:{},invites:[],requests:{},practice:{[world]:match}};
  const pending={kind:'act',match:match.id,version:match.version,action:{kind:'move',x:match.players[0].pos.x+1,y:match.players[0].pos.y},request_id:randomUUID()},posts:unknown[]=[];
  const key='copper-acorn.arena-pending:'+world;
  await page.addInitScript(({key,pending})=>localStorage.setItem(key,JSON.stringify(pending)),{key,pending});
  await page.route('**/arena-recovery-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/src/style.css"><body></body>'}));
  await page.route('**/arena-recovery-fixture',async route=>{
    const r=route.request(),body=r.method()==='POST'?r.postDataJSON():null;if(body)posts.push(body);
    try{const result=arenaStep(store,world,undefined,r.method(),body,Date.now());store=result.state;await route.fulfill({status:result.conflict?409:200,json:result.conflict?{error:result.conflict}:result.view});}
    catch(error){const e=error as Error&{status?:number};await route.fulfill({status:e.status||503,json:{error:e.message}});}
  });
  await page.goto('/arena-recovery-harness');
  await page.evaluate(async world=>{
    const module='/src/arena.ts',arena=await import(module);
    (window as any).arenaRecovery=arena.initArena(()=>({world,nickname:'Mage',connection:async(_path:string,init?:RequestInit)=>{
      const r=await fetch('/arena-recovery-fixture',init),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;
    }}),()=>{});(window as any).arenaRecovery.open();
  },world);
  await expect(page.locator('.arena-board')).toBeVisible();await expect(page.locator('#arena-end')).toBeDisabled();
  await page.locator('#arena-dialog').evaluate(el=>el.scrollTop=el.scrollHeight);
  const retry=page.getByRole('button',{name:'Retry last action',exact:true});await expect(retry).toBeVisible();
  const bounds=(await retry.boundingBox())!,bar=(await page.locator('.arena-combat-bar').boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0);expect(bounds.y+bounds.height).toBeLessThanOrEqual(bar.y);
  await page.screenshot({path:`.local/arena-recovery/pending-${viewport.width}.png`});
  await page.locator('#arena-book').click();await expect(retry).toBeHidden();await expect(page.locator('#arena-spellbook')).toBeVisible();
  await page.locator('#arena-book-close').click();await expect(retry).toBeVisible();expect(posts).toHaveLength(0);
  await retry.click();await expect(page.locator('#arena-status')).toContainText('movement points');
  await expect(retry).toBeHidden();expect(await page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();expect(posts).toEqual([pending]);
  await expect(page.locator('#arena-end')).toBeEnabled();await page.waitForTimeout(1700);await expect(page.locator('#arena-status')).toContainText('movement points');
  await page.locator('[data-cell="3,2"]').click();await expect(page.locator('#arena-status')).toContainText('No movement points');expect(posts).toHaveLength(1);
  await page.screenshot({path:`.local/arena-recovery/recovered-${viewport.width}.png`});
  await page.evaluate(()=>{(window as any).arenaRecovery.reset();(window as any).arenaRecovery.open();});
  await expect(page.locator('.arena-board')).toBeVisible();await expect(page.locator('#arena-status')).toBeEmpty();
  await page.locator('#arena-end').click();await expect(page.locator('#arena-status')).toBeEmpty();
  expect(posts).toHaveLength(2);expect(store.profiles[world].xp).toBe(0);expect(store.practice![world].players[0].mp).toBe(3);
});

for(const viewport of [{width:1440,height:900},{width:320,height:640}])test(`courtyard walking stays quiet while genuine failures retain same-request recovery at ${viewport.width}px`,async({page})=>{
  await page.setViewportSize(viewport);
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.combat-motion','full'));
  const world=randomUUID(),profile={id:world,nickname:'Mage',character:'magician' as const,xp:0,wins:0,losses:0};
  let store:Store={version:1,profiles:{[world]:profile},matches:{},invites:[],requests:{}},fail=0,holdRead=false,readStarted=false,release!:()=>void,releaseRead!:()=>void,releaseSteering!:()=>void,releaseFailure!:()=>void;
  const held=new Promise<void>(resolve=>release=resolve),posts:Record<string,unknown>[]=[],key='copper-acorn.arena-pending:'+world;
  const heldRead=new Promise<void>(resolve=>releaseRead=resolve);
  const heldSteering=new Promise<void>(resolve=>releaseSteering=resolve);
  const heldFailure=new Promise<void>(resolve=>releaseFailure=resolve);
  await page.route('**/arena-walk-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/src/style.css"><body></body>'}));
  await page.route('**/arena-walk-fixture',async route=>{
    const r=route.request(),body=r.method()==='POST'?r.postDataJSON():null;
    if(!body&&holdRead){holdRead=false;readStarted=true;await heldRead;}
    if(body){posts.push(body);if(posts.length===1)await held;if(posts.length===2)await heldFailure;if(posts.length===4)await heldSteering;if(fail)return route.fulfill({status:fail,json:{error:'The arena could not confirm this action.'}});}
    const result=arenaStep(store,world,undefined,r.method(),body,Date.now());store=result.state;await route.fulfill({json:result.view});
  });
  await page.goto('/arena-walk-harness');
  await page.evaluate(async world=>{
    const module='/src/arena.ts',{initArena}=await import(module);
    initArena(()=>({world,nickname:'Mage',connection:async(_path:string,init?:RequestInit)=>{
      const r=await fetch('/arena-walk-fixture',init),data=await r.json();if(!r.ok)throw Object.assign(Error(data.error),{status:r.status});return data;
    }}),()=>{}).open();
  },world);
  const map=page.locator('[data-walkmap]'),recovery=page.locator('.arena-recovery'),retry=page.locator('#arena-retry'),self=page.locator('.arena-world-person.self');
  await expect(map).toBeVisible();const before=await map.boundingBox();
  if(viewport.width===1440){holdRead=true;await expect.poll(()=>readStarted).toBe(true);}
  const clickFloor=(x:number,y:number)=>map.evaluate((el,[x,y])=>{const b=el.getBoundingClientRect(),actor=el.querySelector<HTMLElement>('.self')!,style=getComputedStyle(actor),start=[parseFloat(style.left),parseFloat(style.top)],time=performance.now();(window as any).walkDelay=null;const sample=()=>{const s=getComputedStyle(actor);if(Math.hypot(parseFloat(s.left)-start[0],parseFloat(s.top)-start[1])>.5)(window as any).walkDelay=performance.now()-time;else if(performance.now()-time<1000)requestAnimationFrame(sample);};requestAnimationFrame(sample);el.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:b.left+b.width*x/1536,clientY:b.top+b.height*y/1024}));},[x,y]);
  await clickFloor(900,500);
  await expect(self).toHaveClass(/moving/,{timeout:400});
  await expect.poll(()=>page.evaluate(()=>(window as any).walkDelay),{timeout:500}).not.toBeNull();
  expect(await page.evaluate(()=>(window as any).walkDelay)).toBeLessThan(250);
  await test.info().attach('walking-first-frame',{body:JSON.stringify({width:viewport.width,clickToFirstFrameMs:await page.evaluate(()=>(window as any).walkDelay),queuedBehindRead:readStarted,serverResponseHeld:true}),contentType:'application/json'});
  expect(store.positions?.[world]).toBeUndefined();
  await self.evaluate(el=>{(window as any).walkAnimation=el.getAnimations()[0];});
  if(readStarted){expect(posts).toHaveLength(0);releaseRead();}
  await expect.poll(()=>posts.length).toBe(1);
  expect(posts[0].kind).toBe('walk');await expect(recovery).toBeHidden();await expect(retry).toBeHidden();expect(await map.boundingBox()).toEqual(before);
  await page.screenshot({path:`.local/arena-recovery/walk-quiet-${viewport.width}.png`});
  expect(Math.abs(Number(posts[0].x)-900)).toBeLessThanOrEqual(2);expect(Math.abs(Number(posts[0].y)-500)).toBeLessThanOrEqual(2);
  release();await expect.poll(()=>store.positions?.[world]).toEqual([posts[0].x,posts[0].y]);await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();await expect(recovery).toBeHidden();
  expect(await self.evaluate(el=>el.getAnimations().includes((window as any).walkAnimation)||(window as any).walkAnimation.playState==='finished'&&!el.getAnimations().length)).toBe(true);
  fail=503;await clickFloor(960,500);await expect.poll(()=>posts.length).toBe(2);await clickFloor(980,500);expect(posts).toHaveLength(2);releaseFailure();
  await expect(retry).toBeVisible();await expect(retry).toBeEnabled();
  await page.waitForResponse(r=>r.url().endsWith('/arena-walk-fixture')&&r.request().method()==='GET');
  await expect(page.locator('#arena-status')).toContainText('same request');
  const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key);expect(pending).toEqual(posts[1]);
  await page.waitForResponse(r=>r.url().endsWith('/arena-walk-fixture')&&r.request().method()==='GET');
  await expect(recovery).toBeVisible();expect(posts).toHaveLength(2);expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),key)).toEqual(pending);
  const rolledBack=await self.evaluate(el=>{const s=getComputedStyle(el),map=el.parentElement!;return [parseFloat(s.left)/map.clientWidth*1536,parseFloat(s.top)/map.clientHeight*1024];});
  expect(rolledBack[0]).toBeCloseTo(Number(posts[0].x),0);expect(rolledBack[1]).toBeCloseTo(Number(posts[0].y),0);
  fail=0;await retry.click();await expect.poll(()=>posts.length).toBe(3);expect(posts[2]).toEqual(pending);await expect.poll(()=>store.positions?.[world]).toEqual([pending.x,pending.y]);await expect(recovery).toBeHidden();
  expect(store.profiles[world]).toEqual(profile);await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();await expect(page.locator('#arena-close')).toBeEnabled();
  await expect(self).not.toHaveClass(/moving/);
  await clickFloor(1020,550);await expect.poll(()=>posts.length).toBe(4);
  await clickFloor(1050,550);await clickFloor(1080,550);await self.evaluate(el=>{(window as any).walkAnimation=el.getAnimations()[0];});
  await clickFloor(40,40);expect(posts).toHaveLength(4);expect(store.positions?.[world]).toEqual([pending.x,pending.y]);
  const lastGoal=await self.evaluate(el=>[parseFloat((el as HTMLElement).style.left)/100*1536,parseFloat((el as HTMLElement).style.top)/100*1024]);
  expect(Math.abs(lastGoal[0]-1080)).toBeLessThanOrEqual(2);expect(Math.abs(lastGoal[1]-550)).toBeLessThanOrEqual(2);
  releaseSteering();await expect.poll(()=>posts.length).toBe(5);expect(Math.abs(Number(posts[4].x)-1080)).toBeLessThanOrEqual(2);
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();expect(store.positions?.[world]).toEqual([posts[4].x,posts[4].y]);
  expect(await self.evaluate(el=>el.getAnimations().includes((window as any).walkAnimation)||(window as any).walkAnimation.playState==='finished'&&!el.getAnimations().length)).toBe(true);
  await expect(self).not.toHaveClass(/moving/);
  fail=403;await clickFloor(1120,520);await expect.poll(()=>posts.length).toBe(6);await expect(page.locator('#arena-status')).not.toBeEmpty();
  await expect.poll(()=>page.evaluate(key=>localStorage.getItem(key),key)).toBeNull();await expect(retry).toBeHidden();await expect(self).not.toHaveClass(/moving/);
  const denied=await self.evaluate(el=>{const s=getComputedStyle(el),map=el.parentElement!;return [parseFloat(s.left)/map.clientWidth*1536,parseFloat(s.top)/map.clientHeight*1024];});
  expect(denied[0]).toBeCloseTo(Number(posts[4].x),0);expect(denied[1]).toBeCloseTo(Number(posts[4].y),0);expect(store.positions?.[world]).toEqual([posts[4].x,posts[4].y]);
});
