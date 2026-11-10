import { test, expect, type Page } from './legacy';

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'goblin'));
});

async function open(page: Page) {
  await page.goto('/');
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Goblin/);
  await expect(page.locator('[data-owned="spring_water"]')).toBeVisible();
  return BigInt((await page.locator('[data-owned="spring_water"]').textContent())!);
}
async function collect(page: Page) {
  await page.locator('#gather-spring_water').click();
  await page.getByRole('button', { name: 'Collect Spring Water', exact: true }).click();
}

test('working poses wait for one confirmed transaction and inventory survives reload', async ({ page }) => {
  const before = await open(page);
  let release!: () => void, writes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/action', async route => { writes++; await gate; await route.fulfill({ response: await route.fetch() }); });
  try {
    await collect(page);
    const canvas = page.locator('#game canvas');
    await expect(canvas).toHaveAttribute('data-work', 'approach');
    expect(writes).toBe(0);
    await expect(canvas).toHaveAttribute('data-work', 'pending');
    await expect(canvas).toHaveAttribute('data-facing', 'north');
    await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before));
    const frames = await canvas.evaluate(element => new Promise<number[]>(resolve => {
      const seen = new Set<number>(), start = performance.now();
      const sample = () => { seen.add(Number((element as HTMLElement).dataset.workFrame)); if (performance.now()-start < 800) requestAnimationFrame(sample); else resolve([...seen]); };
      sample();
    }));
    expect(frames.sort()).toEqual([1,2]);
    await expect(canvas).toHaveAttribute('data-work','pending');
    await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before));
    await canvas.screenshot({ path: '.local/integrated-water-waiting.png' });
    release();
    await expect(canvas).toHaveAttribute('data-work', 'idle');
    await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before + 1n));
    await expect(page.locator('#action-status')).toContainText('Confirmed.');
    expect(writes).toBe(1);
    expect(await page.evaluate(() => sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
    await page.screenshot({ path: '.local/integrated-game-desktop.png', fullPage: true });
    await page.reload();
    await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before + 1n));
  } finally { release(); }
});

test('pending mining and harvesting keep moving without claiming an unconfirmed reward',async({page})=>{
  for(const [token,verb,resultFrame] of [['silver_dust','Mine Silver Dust',4],['sunleaf','Harvest Sunleaf',3]] as const) {
    let release!:()=>void,writes=0;
    const gate=new Promise<void>(resolve=>release=resolve);
    await page.route('**/api/action',async route=>{writes++;await gate;await route.fulfill({json:{status:'failed',result:{},error:'Controlled failure: no goods granted.'}});});
    try {
      await open(page);
      const stock=await page.locator(`[data-owned="${token}"]`).textContent();
      await page.locator('#gather-'+token).click();
      await page.getByRole('button',{name:verb,exact:true}).click();
      const canvas=page.locator('#game canvas');
      await expect(canvas).toHaveAttribute('data-work','pending');
      const frames=await canvas.evaluate(element=>new Promise<number[]>(resolve=>{
        const seen=new Set<number>(),start=performance.now();
        const sample=()=>{seen.add(Number((element as HTMLElement).dataset.workFrame));if(performance.now()-start<900)requestAnimationFrame(sample);else resolve([...seen]);};sample();
      }));
      expect(frames.length).toBeGreaterThan(1);expect(frames.every(f=>f>0&&f<resultFrame)).toBe(true);
      await expect(page.locator(`[data-owned="${token}"]`)).toHaveText(stock!);expect(writes).toBe(1);
      release();await expect(canvas).toHaveAttribute('data-work','idle');
      await expect(page.locator('#action-status')).toContainText('Controlled failure');
      await expect(page.locator(`[data-owned="${token}"]`)).toHaveText(stock!);
    } finally {release();await page.unroute('**/api/action');}
  }
});

test('canceling the approach submits nothing; a rejected action has no result effect or inventory award', async ({ page }) => {
  const before = await open(page);
  let writes = 0;
  await page.route('**/api/action', route => { writes++; return route.fulfill({ json: { status: 'failed', result: {}, error: 'The spring is unavailable.' } }); });
  await collect(page);
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('data-work', 'approach');
  await expect(canvas).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#action-status')).toContainText('canceled before submission');
  await expect(canvas).toHaveAttribute('data-work', 'idle');
  expect(writes).toBe(0);
  await collect(page);
  await expect(page.locator('#action-status')).toContainText('spring is unavailable');
  await expect(canvas).toHaveAttribute('data-work', 'idle');
  await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before));
  expect(writes).toBe(1);
  expect(await page.evaluate(() => sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
});

test('changing appearance discards an old animation while its submitted action settles once', async ({ page }) => {
  const before = await open(page);
  let release!: () => void, writes = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/action', async route => { writes++; await gate; await route.fulfill({ response: await route.fetch() }); });
  try {
    await collect(page);
    const canvas = page.locator('#game canvas');
    await expect(canvas).toHaveAttribute('data-work', 'pending');
    await page.getByRole('button', { name: 'Choose character', exact: true }).click();
    await page.getByRole('radio', { name: 'Dark Elf', exact: true }).check();
    await page.getByRole('button', { name: 'Use this character', exact: true }).click();
    await expect(canvas).toHaveAttribute('aria-label', /Dark Elf/);
    await expect(canvas).toHaveAttribute('data-work', 'idle');
    release();
    await expect(page.locator('[data-owned="spring_water"]')).toHaveText(String(before + 1n));
    await expect(page.locator('#action-status')).toContainText('Confirmed.');
    await expect(canvas).toHaveAttribute('aria-label', /Dark Elf/);
    expect(writes).toBe(1);
  } finally { release(); }
});
