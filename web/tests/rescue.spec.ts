import { test, expect } from './legacy';

test.beforeEach(async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
});

async function recoveryState(request:any) {
  const state=await(await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  state.player.balances.copper='0';
  state.world.mana_rescue={used:false,pending:false,available:true};
  state.environment.native_balance='0';state.environment.rescue_available=true;
  return state;
}

test('free rescue restores simulated Mana once without a Copper charge or extra submission',async({page,request})=>{
  const state=await recoveryState(request);let calls=0,release!:()=>void;
  const gate=new Promise<void>(resolve=>release=resolve);
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  await page.route('**/api/action',async r=>{
    calls++;expect(r.request().postDataJSON().action).toEqual({kind:'rescue'});await gate;
    state.world.mana_rescue={used:true,pending:false,available:false};
    state.environment.native_balance=state.environment.starter_native;state.environment.rescue_available=false;
    await r.fulfill({json:{status:'confirmed',result:{hash:'simulated-rescue-receipt',method:'request_mana_rescue'},error:null}});
  });
  try {
    await page.goto('/');await expect(page.locator('#rescue')).toBeEnabled();
    await page.locator('#rescue').click();
    await page.locator('#rescue').evaluate((b:HTMLButtonElement)=>b.click());
    await expect(page.locator('#rescue')).toBeDisabled();expect(calls).toBe(1);
    release();await expect(page.locator('#action-status')).toContainText('Guild rescue confirmed');
    await expect(page.locator('#rescue')).toBeHidden();await expect(page.locator('#copper')).toHaveText('0');
    await expect(page.locator('#mana-label')).toHaveText('Ready');
    await page.reload();await expect(page.locator('#rescue')).toBeHidden();expect(calls).toBe(1);
  } finally {release();}
});

test('empty reserve and an already used rescue disable the button without sending an action',async({page,request})=>{
  const state=await recoveryState(request);let writes=0;
  state.world.native_pool='0';state.world.mana_rescue.available=false;state.environment.rescue_available=false;
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  await page.route('**/api/action',r=>{writes++;return r.abort();});
  await page.goto('/');await expect(page.locator('#rescue')).toBeDisabled();
  await expect(page.locator('#rescue-detail')).toContainText('reserve cannot fund');
  state.world.mana_rescue.used=true;
  await page.reload();await expect(page.locator('#rescue')).toHaveText('Guild rescue used');
  await expect(page.locator('#rescue')).toBeDisabled();expect(writes).toBe(0);
});

test('an unknown rescue payout stays paused across reload and never repeats the request',async({page,request})=>{
  const state=await recoveryState(request);let writes=0;
  const unknown={status:'unconfirmed',result:{},error:'Payout outcome is not confirmed.'};
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  await page.route('**/api/action',r=>{writes++;return r.fulfill({json:unknown});});
  await page.route('**/api/actions/*',r=>r.fulfill({json:unknown}));
  await page.goto('/');await page.locator('#rescue').click();
  await expect(page.locator('#action-status')).toContainText('Refresh ledger');
  await expect(page.locator('#rescue')).toBeDisabled();
  await page.reload();await expect(page.locator('#rescue')).toBeDisabled();
  await expect(page.locator('#copper')).toHaveText('0');await expect(page.locator('#mana-label')).toHaveText('Empty');
  expect(writes).toBe(1);
  expect(await page.evaluate(()=>sessionStorage.getItem('copper-acorn.pending'))).not.toBeNull();
});
