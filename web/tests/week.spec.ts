import { test, expect } from './legacy';
import { WORLD, merchants } from '../src/isometric-layout';

// shortcut: the serial browser suite shares one local world; keep the opening-loop fixture before the week tests.

test('scheduled merchant turn uses cached Jev and is idempotent across duplicate requests', async ({ page, request }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character','goblin'));
  await page.clock.install();
  await page.goto('/');
  await expect(page.locator('#market-clock')).toContainText('Market paused');
  const before = await (await request.get('http://127.0.0.1:3101/api/state')).json();
  await page.getByRole('button',{name:'Start market',exact:true}).click();
  const sent = page.waitForResponse(r=>r.url().endsWith('/api/action') && r.request().method()==='POST');
  await page.clock.runFor(30_000);
  const response = await sent;
  const payload = response.request().postDataJSON();
  const original = await response.json();
  expect(original.status).toBe('confirmed');
  expect(payload.action).toEqual({kind:'market_tick',tick:before.market.tick});
  await expect(page.getByRole('button',{name:'Pause market',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Pause market',exact:true}).click();
  const duplicate = await request.post('http://127.0.0.1:3101/api/action',{data:payload});
  expect(await duplicate.json()).toEqual(original);
  const stale = await request.post('http://127.0.0.1:3101/api/action',{data:{...payload,request_id:crypto.randomUUID()}});
  expect(stale.status()).toBe(409);
  const after = await (await request.get('http://127.0.0.1:3101/api/state')).json();
  expect(after.market.tick).toBe(before.market.tick+1);
  expect(after.market.source).toBe('cached_jev');
  expect(after.market.events.at(-1).receipt.hash).toBeTruthy();
  expect(after.market.events.at(-1).model).toBe('jev-1.14.0');
  const copper = [after.player,after.customer,...after.merchants.map((m:any)=>m.account)].reduce((sum:bigint,w:any)=>sum+BigInt(w.balances.copper),0n);
  expect(copper).toBeLessThanOrEqual(5000n);
  await page.clock.runFor(60_000);
  expect((await (await request.get('http://127.0.0.1:3101/api/state')).json()).market.tick).toBe(after.market.tick);
});

test('connected guild trials and two optional orders consume goods, pay once and preserve post-Seal trading', async ({ page, request }) => {
  const endpoint='http://127.0.0.1:3101';
  let before=await (await request.get(`${endpoint}/api/state`)).json();
  expect(before.quests.escrow_remaining).toBe('141');
  const act=async(action:object)=>{
    const response=await request.post(`${endpoint}/api/action`,{data:{request_id:crypto.randomUUID(),world_id:before.environment.world_id,action}});
    expect(response.ok()).toBeTruthy();
    const result=await response.json(); expect(result.status).toBe('confirmed'); expect(result.result.hash).toBeTruthy(); return result;
  };
  await act({kind:'next_day'});
  before=await (await request.get(`${endpoint}/api/state`)).json();
  for(const [token,required] of [['moonmint',3],['wood_essence',3],['spring_water',9],['sunleaf',8],['emberbloom',1],['silver_dust',1]] as const) {
    const missing=required-Number(before.player.balances[token]);
    for(let n=0;n<missing;n++) await act({kind:'gather',token_id:token});
  }
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
  await page.goto('/');
  const clickAction=async(name:string,action:object)=>{
    const sent=page.waitForResponse(r=>r.url().endsWith('/api/action') && r.request().method()==='POST');
    await page.getByRole('button',{name,exact:true}).click();
    const response=await sent;expect(response.request().postDataJSON().action).toEqual(action);
    const result=await response.json();expect(result.status).toBe('confirmed');expect(result.result.hash).toBeTruthy();
    await expect(page.locator('#action-status')).toContainText('Confirmed.');
  };
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await clickAction('Brew Healing Tonic',{kind:'brew',token_id:'healing_tonic'});
  await page.getByRole('button',{name:'Shelves',exact:true}).click();
  await page.getByLabel('Price in Copper').fill('13');
  await clickAction('Put on shelf',{kind:'list',token_id:'healing_tonic',price:'13'});
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await clickAction('Serve gardener · 13 Copper',{kind:'serve_customer'});
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  await expect(page.locator('[data-quest-step="0"]')).toHaveAttribute('data-progress','Complete');
  await expect(page.locator('[data-quest-step="1"]')).toHaveAttribute('data-progress','Current objective');
  await page.locator('#quest-history').click();
  await expect(page.getByRole('button',{name:'Deliver Restoration Elixir',exact:true})).toBeDisabled();
  await page.locator('[data-side-quest="rowan"]>summary').click();
  for(let n=0;n<2;n++) await clickAction('Deliver Spring Water',{kind:'deliver',token_id:'spring_water'});
  await expect(page.locator('[data-side-quest="rowan"]')).toContainText('He thanks you');
  const sideFirst=await (await request.get(`${endpoint}/api/state`)).json();
  expect(sideFirst.quests.story.stage).toBe(1);expect(sideFirst.quests.delivered).toEqual([0,0,0]);
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  for(const [token,name,count] of [['healing_tonic','Healing Tonic',3],['focus_draught','Focus Draught',3],['restoration_elixir','Restoration Elixir',1]] as const) {
    await page.locator('#recipe-select').selectOption(token);
    for(let n=0;n<count;n++) await clickAction(`Brew ${name}`,{kind:'brew',token_id:token});
  }
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  for(const [token,name,count] of [['focus_draught','Focus Draught',2],['restoration_elixir','Restoration Elixir',1]] as const) {
    for(let n=0;n<count;n++) await clickAction(`Deliver ${name}`,{kind:'deliver',token_id:token});
    if(token==='focus_draught') {
      await expect(page.locator('[data-quest-step="2"]')).toHaveAttribute('data-progress','Current objective');
      await page.reload();
      await page.getByRole('button',{name:'Quests',exact:true}).click();
      await expect(page.getByRole('button',{name:'Deliver Restoration Elixir',exact:true})).toBeEnabled();
    }
  }
  const mainComplete=await (await request.get(`${endpoint}/api/state`)).json();
  expect(mainComplete.quests.seal).toBe(true);expect(mainComplete.quests.gardener_complete).toBe(false);
  expect(mainComplete.quests.delivered).toEqual([0,2,1]);expect(mainComplete.quests.escrow_remaining).toBe('39');
  await page.reload();
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  await expect(page.locator('#panel')).toContainText('earned the guild’s seal');
  await page.locator('[data-side-quest="mira"]>summary').click();
  for(let n=0;n<3;n++) await clickAction('Deliver Healing Tonic',{kind:'deliver',token_id:'healing_tonic'});
  const after=await (await request.get(`${endpoint}/api/state`)).json();
  expect(after.quests.seal).toBe(true); expect(after.quests.gardener_complete).toBe(true);
  expect(after.quests.escrow_remaining).toBe('0');
  expect(after.quests.story.stage).toBe(3);expect(after.quests.story.water_delivered).toBe(2);
  expect(after.quests.story.tonic_brewed).toBe(true);expect(after.quests.story.tonic_sold).toBe(true);
  expect(BigInt(after.player.balances.copper)).toBe(BigInt(before.player.balances.copper)+141n+13n-8n);
  for(const token of ['healing_tonic','focus_draught','restoration_elixir']) expect(after.player.balances[token]).toBe('0');
  await expect(page.locator('#panel')).toContainText('The Alchemist’s Seal');
  await expect(page.getByRole('button',{name:'Deliver Healing Tonic',exact:true})).toBeDisabled();
  await page.locator('#quest-history').click();
  await expect(page.getByRole('button',{name:'Deliver Restoration Elixir',exact:true})).toBeDisabled();
  const canvas=page.locator('#game canvas'),bounds=(await canvas.boundingBox())!;
  for(const neighbor of merchants) {
    await canvas.click({position:{x:neighbor.feet[0]*bounds.width/WORLD.width,y:(neighbor.feet[1]-110)*bounds.height/WORLD.height}});
    await page.locator('#interaction-quest').click();
    await expect(page.locator('#interaction-text')).toContainText(neighbor.id==='bram' ? 'awarded you the Alchemist’s Seal' : neighbor.id==='rowan' ? 'water order is paid' : 'Every gardener has a remedy');
    await page.getByRole('button',{name:'Open quest journal',exact:true}).click();
  }
  await page.locator('#panel').screenshot({path:'.local/quest-complete.png'});
  await page.reload();
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  await expect(page.locator('#panel')).toContainText('earned the guild’s seal');
  await act({kind:'next_day'});
  for(let n=0;n<2;n++) await act({kind:'gather',token_id:'sunleaf'});
  await act({kind:'gather',token_id:'spring_water'});
  await page.getByRole('button',{name:'Refresh ledger',exact:true}).click();
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await clickAction('Brew Healing Tonic',{kind:'brew',token_id:'healing_tonic'});
  await page.getByRole('button',{name:'Shelves',exact:true}).click();
  await page.getByLabel('Price in Copper').fill('13');
  await clickAction('Put on shelf',{kind:'list',token_id:'healing_tonic',price:'13'});
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await clickAction('Serve gardener · 13 Copper',{kind:'serve_customer'});
  const tradingContinues=await (await request.get(`${endpoint}/api/state`)).json();
  expect(tradingContinues.quests).toEqual(after.quests);
  expect(BigInt(tradingContinues.player.balances.copper)).toBe(BigInt(after.player.balances.copper)+12n);
});

test('a confirmed contract rejection preserves stock and allows the next valid action',async({request})=>{
  const base='http://127.0.0.1:3101';
  const before=await(await request.get(`${base}/api/state`)).json();
  const data={world_id:before.environment.world_id,request_id:crypto.randomUUID(),action:{kind:'deliver',token_id:'restoration_elixir'}};
  const rejected=await(await request.post(`${base}/api/action`,{data})).json();
  expect(rejected.status).toBe('failed');
  expect(await(await request.post(`${base}/api/action`,{data})).json()).toEqual(rejected);
  const after=await(await request.get(`${base}/api/state`)).json();
  expect(after.player).toEqual(before.player); expect(after.quests).toEqual(before.quests);
  expect(after.market.blocked).toBe(false);
  const continued=await(await request.post(`${base}/api/action`,{data:{...data,request_id:crypto.randomUUID(),action:{kind:'next_day'}}})).json();
  expect(continued.status).toBe('confirmed');
});
