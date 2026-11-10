import { test, expect } from './legacy';
import { WORLD, merchants, spots } from '../src/isometric-layout';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'magician'));
});

test('resource prompts can be canceled, pause movement and confirm exactly one collection', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/');
  await expect(page.locator('#copper')).toHaveText('40');
  await page.locator('#gather-sunleaf').click();
  const dialog = page.getByRole('dialog', {name:'Sunleaf', exact:true});
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Collect one unit');
  await expect(page.getByRole('button',{name:'Harvest Sunleaf',exact:true})).toBeEnabled();
  await page.keyboard.press('w');
  expect(writes).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#gather-sunleaf')).toBeFocused();
  await expect(page.locator('[data-owned="sunleaf"]')).toHaveText('4');
  await page.locator('#gather-sunleaf').click();
  await page.locator('#interaction-confirm').evaluate((button: HTMLButtonElement) => { button.click(); button.click(); });
  await expect(page.locator('[data-owned="sunleaf"]')).toHaveText('5');
  await expect(page.locator('#action-status')).toContainText('Confirmed');
  expect(writes).toHaveLength(1);
  expect(await page.evaluate(() => sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
});

test('clicking merchant character PNGs opens short dialogue, advice and their stall without a trade', async ({ page }) => {
  const writes: string[] = [], errors: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  const bounds = (await canvas.boundingBox())!;
  for (const merchant of merchants) {
    await canvas.click({position:{x:merchant.feet[0]*bounds.width/WORLD.width,y:(merchant.feet[1]-110)*bounds.height/WORLD.height}});
    const name = merchant.id[0].toUpperCase()+merchant.id.slice(1);
    const dialog = page.getByRole('dialog',{name,exact:true});
    await expect(dialog).toBeVisible();
    const greeting = await page.locator('#interaction-text').textContent();
    await page.getByRole('button',{name:'Any advice?',exact:true}).click();
    await expect(page.locator('#interaction-text')).not.toHaveText(greeting!);
    await page.locator('#interaction-quest').click();
    await expect(page.locator('#interaction-text')).toContainText(merchant.id === 'bram' ? 'First brew a Healing Tonic' : merchant.id === 'rowan' ? 'two flasks of Spring Water' : 'three Healing Tonics');
    await page.getByRole('button',{name:'Open quest journal',exact:true}).click();
    await expect(page.locator('#quest-tab')).toHaveAttribute('aria-pressed','true');
    await canvas.click({position:{x:merchant.feet[0]*bounds.width/WORLD.width,y:(merchant.feet[1]-110)*bounds.height/WORLD.height}});
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button',{name:'Visit stall',exact:true})).toBeVisible();
    await page.screenshot({path:`.local/dialogue-${merchant.id}.png`,fullPage:true});
    await page.getByRole('button',{name:'Visit stall',exact:true}).click();
    await expect(page.locator(`#merchant-${merchant.id}`)).toHaveAttribute('aria-pressed','true');
    await expect(page.locator('#ledger')).toBeFocused();
  }
  expect(writes).toEqual([]); expect(errors).toEqual([]);
});

test('the fresh quest journal explains the opening sale, locked trials and independent side orders',async({page})=>{
  const writes:string[]=[];
  page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  await page.goto('/');
  await page.getByRole('button',{name:'Read the guild letter',exact:true}).click();
  await expect(page.locator('[data-quest-step="0"]')).toHaveAttribute('data-progress','Current objective');
  await expect(page.locator('[data-quest-step="1"]')).toHaveAttribute('data-progress','Locked');
  await page.locator('#quest-history').click();
  await expect(page.getByRole('button',{name:'Deliver Focus Draught',exact:true})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Deliver Restoration Elixir',exact:true})).toBeDisabled();
  await page.locator('[data-side-quest="rowan"]>summary').click();
  await expect(page.getByRole('button',{name:'Deliver Spring Water',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'View recipes',exact:true}).click();
  await expect(page.locator('#brew-healing_tonic')).toBeEnabled();
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  await page.getByRole('button',{name:'Find Spring Water',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Spring Water',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await page.setViewportSize({width:320,height:800});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
  await expect(page.locator('[data-side-quest="rowan"]')).toBeVisible();
  expect(writes).toEqual([]);
});

test('each gathering action has the right verb, artwork and a small-screen prompt', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', request => { if (request.method()==='POST') writes.push(request.url()); });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  const bounds = (await canvas.boundingBox())!;
  for (const [id, verb] of Object.entries({sunleaf:'Harvest',moonmint:'Harvest',emberbloom:'Pick',spring_water:'Collect',wood_essence:'Tap',silver_dust:'Mine'})) {
    const spot=spots.find(s=>s.id===id)!;
    await canvas.click({position:{x:spot.at[0]*bounds.width/WORLD.width,y:spot.at[1]*bounds.height/WORLD.height}});
    await expect(page.locator('#interaction-dialog')).toBeVisible();
    await expect(page.locator('#interaction-confirm')).toHaveText(new RegExp(`^${verb} `));
    expect(await page.locator('#interaction-portrait').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth===48)).toBe(true);
    await page.getByRole('button',{name:'Leave',exact:true}).click();
  }
  await page.setViewportSize({width:320,height:800});
  await page.locator('#gather-moonmint').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
  expect(await page.locator('#interaction-dialog').evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.screenshot({path:'.local/gather-prompt-mobile.png',fullPage:true});
  await page.keyboard.press('Escape');
  expect(writes).toEqual([]);
});

test('older saved orders stay available without opting into the new quest chain (simulated save)',async({page})=>{
  let writes=0;
  page.on('request',r=>{if(r.method()==='POST')writes++;});
  await page.route('**/api/state',async route=>{
    const state=await (await route.fetch()).json();
    delete state.batch_limit;delete state.alchemist;
    delete state.quests.story;state.quests.delivered=[0,0,0];state.quests.seal=false;
    state.player.balances.restoration_elixir='1';
    await route.fulfill({json:state});
  });
  await page.goto('/');
  await page.getByRole('button',{name:'Quests',exact:true}).click();
  await expect(page.getByRole('button',{name:'Deliver Restoration Elixir',exact:true})).toBeEnabled();
  await expect(page.locator('[data-quest-step="2"]')).toHaveAttribute('data-progress','Available order');
  await expect(page.locator('#panel')).not.toContainText('Finish the Focus trial to unlock');
  await expect(page.locator('[data-side-quest="rowan"]')).toHaveCount(0);
  expect(writes).toBe(0);
});
