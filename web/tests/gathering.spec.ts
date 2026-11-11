import {test,expect} from './legacy';
import {WORLD,spots} from '../src/isometric-layout';

test('fresh silver can be mined once; reloading explains the saved market-day limit',async({page,request})=>{
  const before=await (await request.get('http://127.0.0.1:3101/api/state')).json();
  expect(before.catalog.find((i:any)=>i.token_id==='silver_dust').gathered_today).toBe('0');
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','skeleton'));
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  await page.goto('/');
  await page.locator('#gather-silver_dust').click();
  await expect(page.locator('#interaction-detail')).toContainText('1 left this market day');
  await expect(page.locator('#interaction-confirm')).toBeEnabled();
  await page.locator('#interaction-confirm').click();
  await expect(page.locator('[data-owned="silver_dust"]')).toHaveText(String(BigInt(before.player.balances.silver_dust)+1n));
  await expect(page.locator('#action-status')).toContainText('Confirmed');
  await page.reload();
  const canvas=page.locator('#game canvas');await expect(canvas).toHaveAttribute('aria-label',/Liche/);
  const bounds=(await canvas.boundingBox())!,spot=spots.find(s=>s.id==='silver_dust')!;
  await canvas.click({position:{x:spot.at[0]*bounds.width/WORLD.width,y:spot.at[1]*bounds.height/WORLD.height}});
  await expect(page.locator('#interaction-detail')).toContainText(`collected 1/1 Silver Dust on market day ${before.world.day+1}`);
  await expect(page.locator('#interaction-detail')).toContainText('Reopening the game does not start a new market day');
  await expect(page.locator('#interaction-confirm')).toBeDisabled();
  await page.screenshot({path:'.local/silver-saved-progress.png',fullPage:true});
  expect(writes).toHaveLength(1);
});

test('a save without silver gathering does not promise replenishment',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','skeleton'));
  await page.route('**/api/state*',async route=>{
    const response=await route.fetch(),state=await response.json();
    delete state.alchemist;delete state.batch_limit;
    Object.assign(state.catalog.find((i:any)=>i.token_id==='silver_dust'),{gather_cap:'0',gathered_today:'0'});
    await route.fulfill({json:state});
  });
  const writes:string[]=[];page.on('request',r=>{if(r.method()==='POST')writes.push(r.url());});
  await page.goto('/');
  const canvas=page.locator('#game canvas');await expect(canvas).toHaveAttribute('aria-label',/Liche/);
  const bounds=(await canvas.boundingBox())!,spot=spots.find(s=>s.id==='silver_dust')!;
  await canvas.click({position:{x:spot.at[0]*bounds.width/WORLD.width,y:spot.at[1]*bounds.height/WORLD.height}});
  await expect(page.locator('#interaction-detail')).toContainText('cannot be gathered in this saved game');
  await expect(page.locator('#interaction-detail')).not.toContainText('replenish');
  await expect(page.locator('#interaction-confirm')).toBeDisabled();
  expect(writes).toEqual([]);
});
