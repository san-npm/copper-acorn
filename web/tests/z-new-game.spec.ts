import {test,expect,type Page} from '@playwright/test';

let first='',second='';
const endpoint='http://127.0.0.1:3101';
async function enter(page:Page,id:string){
  await page.addInitScript(id=>sessionStorage.setItem('copper-acorn.local-world',id),id);await page.goto('/');
  await expect(page.locator('#games-dialog')).toBeVisible();
  if(await page.locator('#continue-game').isVisible())await page.locator('#continue-game').click();else await page.locator('#new-game').click();
}
async function state(request:any,id:string){return(await request.get(`${endpoint}/api/state?world_id=${id}`)).json();}

test('a nickname and character lock to a new save and survive a browser preference change',async({page,request})=>{
  const original=await(await request.get(`${endpoint}/api/state`)).json();
  const body={request_id:crypto.randomUUID(),world_id:original.environment.world_id};
  const created=await(await request.post(`${endpoint}/api/new-game`,{data:body})).json();first=created.world_id;
  expect(await(await request.post(`${endpoint}/api/new-game`,{data:body})).json()).toEqual(created);
  await enter(page,first);
  await expect(page.locator('#character-dialog')).toBeVisible();
  await expect(page.locator('#use-character')).toBeDisabled();
  await page.locator('#nickname').fill('Moon Keeper');
  await page.getByRole('radio',{name:'Goblin',exact:true}).check();
  await page.locator('#use-character').click();
  await expect(page.locator('#character-name')).toHaveText('Moon Keeper · Goblin');
  const saved=await state(request,first);expect(saved.alchemist).toEqual({nickname:'Moon Keeper',character_id:'goblin'});
  await page.getByRole('button',{name:'Your alchemist',exact:true}).click();
  await expect(page.getByRole('radio',{name:'Elf',exact:true})).toBeDisabled();await expect(page.locator('#nickname')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.evaluate(()=>localStorage.setItem('copper-acorn.sandbox-character','vampire'));await page.reload();
  await expect(page.locator('#character-name')).toHaveText('Moon Keeper · Goblin');
  const rejected=await(await request.post(`${endpoint}/api/action`,{data:{request_id:crypto.randomUUID(),world_id:first,action:{kind:'choose_alchemist',nickname:'Other Name',character_id:'elf'}}})).json();
  expect(rejected.status).toBe('failed');expect((await state(request,first)).alchemist).toEqual(saved.alchemist);
  expect((await(await request.get(`${endpoint}/api/state`)).json()).player).toEqual(original.player);
});

test('quantities gather, craft, trade and deliver in one confirmed action with exact stock, prices and fees',async({page,request})=>{
  await enter(page,first);await expect(page.locator('#character-name')).toHaveText('Moon Keeper · Goblin');
  const click=async(selector:string,amount:string)=>{
    const before=await state(request,first),response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/action'&&r.request().method()==='POST');
    await page.locator(selector).click();const sent=await response;
    expect(sent.request().postDataJSON().action.amount).toBe(amount);expect((await sent.json()).status).toBe('confirmed');
    await expect(page.locator('#action-status')).toContainText('Confirmed.');
    const after=await state(request,first);expect(after.player.next_action).toBe(before.player.next_action+1);return {before,after};
  };
  await page.locator('#gather-sunleaf').click();await page.locator('#gather-amount').selectOption('4');
  let result=await click('#interaction-confirm','4');expect(result.after.player.balances.sunleaf).toBe('8');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();await page.locator('#action-amount').selectOption('3');
  result=await click('#brew-healing_tonic','3');expect(result.after.player.balances.healing_tonic).toBe('3');expect(result.after.player.balances.copper).toBe('37');expect(result.after.player.balances.spring_water).toBe('0');
  await page.getByRole('button',{name:'Market',exact:true}).click();await page.locator('#action-amount').selectOption('2');
  result=await click('#sell-mira-sunleaf','2');
  const price=result.before.merchants[0].quotes.find((q:any)=>q.token_id==='sunleaf').sell_totals[1];
  expect(BigInt(result.after.player.balances.copper)).toBe(BigInt(result.before.player.balances.copper)+BigInt(price));
  await page.getByRole('button',{name:'Quests',exact:true}).click();await page.locator('#action-amount').selectOption('3');
  await page.locator('[data-side-quest="mira"]>summary').click();
  result=await click('[data-deliver="healing_tonic"]','3');expect(result.after.quests.gardener_complete).toBe(true);expect(result.after.quests.story.stage).toBe(0);
  expect(BigInt(result.after.player.balances.copper)).toBe(BigInt(result.before.player.balances.copper)+39n);expect(result.after.player.balances.healing_tonic).toBe('0');
  const rejected=await request.post(`${endpoint}/api/action`,{data:{request_id:crypto.randomUUID(),world_id:first,action:{kind:'gather',token_id:'spring_water',amount:'0'}}});expect(rejected.status()).toBe(400);
  expect((await state(request,first)).market.blocked).toBe(false);
  await page.screenshot({path:'.local/quantity-compact-ledger.png',fullPage:true});
});

test('new game keeps both identities and inventories, and selecting a saved game restores them',async({page,request})=>{
  await enter(page,first);const before=await state(request,first);
  await page.getByRole('button',{name:'Saved games',exact:true}).click();await page.locator('#new-game').click();
  await expect(page.locator('#character-dialog')).toBeVisible();
  await page.locator('#nickname').fill('Silver Fern');await page.getByRole('radio',{name:'Elf',exact:true}).check();await page.locator('#use-character').click();
  await expect(page.locator('#character-name')).toHaveText('Silver Fern · Elf');
  second=await page.evaluate(()=>sessionStorage.getItem('copper-acorn.local-world')!);expect(second).not.toBe(first);
  expect((await state(request,second)).player.balances.copper).toBe('40');expect((await state(request,first)).player).toEqual(before.player);
  await page.getByRole('button',{name:'Saved games',exact:true}).click();await expect(page.locator('#new-game')).toBeDisabled();
  await page.getByRole('button',{name:/Moon Keeper · Goblin/}).click();
  await expect(page.locator('#character-name')).toHaveText('Moon Keeper · Goblin');
  expect((await state(request,first)).player).toEqual(before.player);expect((await state(request,second)).alchemist.nickname).toBe('Silver Fern');
});

test('ambient motion changes foliage, water and NPC eyes without writes and stops for reduced motion',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  await enter(page,first);const canvas=page.locator('#game canvas');await expect(canvas).toHaveAttribute('data-ambient-frame',/\d+/);
  const changes=await canvas.evaluate(element=>new Promise<number[]>(resolve=>{
    const c=(element as HTMLCanvasElement).getContext('2d')!,sets=[new Set<number>(),new Set<number>(),new Set<number>()],start=performance.now();
    const sample=()=>{[[950,320,65,65],[830,555,80,60],[357,635,45,28]].forEach(([x,y,w,h],i)=>{let hash=0;for(const p of c.getImageData(x,y,w,h).data)hash=(hash*31+p)|0;sets[i].add(hash);});if(performance.now()-start<6100)setTimeout(sample,100);else resolve(sets.map(s=>s.size));};sample();
  }));expect(changes.every(n=>n>1)).toBe(true);
  await canvas.screenshot({path:'.local/living-town.png'});
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(250);
  const still=await canvas.evaluate(async element=>{const c=(element as HTMLCanvasElement).getContext('2d')!;const hash=()=>{let h=0;for(const p of c.getImageData(950,320,65,65).data)h=(h*31+p)|0;return h;};const a=hash();await new Promise(r=>setTimeout(r,400));return [a,hash()];});expect(still[0]).toBe(still[1]);expect(writes).toBe(0);
});

test('a stale visitor request fails without freezing the save or repeating its sale',async({request})=>{
  const post=async(action:object,request_id=crypto.randomUUID())=>{
    const response=await request.post(`${endpoint}/api/action`,{data:{request_id,world_id:first,action}});
    expect(response.ok()).toBe(true);return response.json();
  };
  for(const action of [{kind:'gather',token_id:'sunleaf',amount:'2'},{kind:'gather',token_id:'spring_water'},{kind:'brew',token_id:'healing_tonic'},{kind:'list',token_id:'healing_tonic',price:'13'},{kind:'serve_customer'}])expect((await post(action)).status).toBe('confirmed');
  const before=await state(request,first),request_id=crypto.randomUUID();
  const rejected=await post({kind:'serve_customer'},request_id);expect(rejected.status).toBe('failed');
  expect(await post({kind:'serve_customer'},request_id)).toEqual(rejected);
  const after=await state(request,first);expect(after.player).toEqual(before.player);expect(after.customer).toEqual(before.customer);expect(after.market.blocked).toBe(false);
  expect((await post({kind:'gather',token_id:'moonmint'})).status).toBe('confirmed');
});
