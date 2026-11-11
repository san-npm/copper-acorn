import { test, expect } from './legacy';
import { WORLD, ACTOR, spots } from '../src/isometric-layout';

test('isometric scene loads and every resource and shop location remains reachable', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'goblin'));
  const errors: string[] = [], failed: string[] = [], loaded = new Set<string>();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failed.push(new URL(request.url()).pathname));
  page.on('response', response => {
    const path = new URL(response.url()).pathname;
    if ((path.startsWith('/assets/market/') || path.startsWith('/assets/isometric/')) && path.endsWith('.png') && response.ok()) loaded.add(path);
  });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Goblin/);
  await expect.poll(() => loaded.size).toBe(7);
  expect(loaded.has('/assets/isometric/world.png')).toBe(true);
  for (const name of ['mira', 'rowan', 'bram']) for(const suffix of ['', '-blink'])expect(loaded.has(`/assets/market/${name}${suffix}.png`)).toBe(true);
  const bounds = (await canvas.boundingBox())!;
  const click = (id: string) => { const spot = spots.find(s => s.id === id)!; return canvas.click({ position: { x: spot.at[0] * bounds.width / WORLD.width, y: spot.at[1] * bounds.height / WORLD.height } }); };
  await click('cauldron');
  await page.getByRole('button', { name: 'Choose a recipe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little careful brewing' })).toBeVisible();
  await click('shelves');
  await page.getByRole('button', { name: 'Manage shelves', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stock your shelves' })).toBeVisible();
  await click('mira');
  await page.getByRole('button', { name: 'Visit stall', exact: true }).click();
  await expect(page.locator('#merchant-mira')).toHaveAttribute('aria-pressed', 'true');
  await click('rowan');
  await page.getByRole('button', { name: 'Visit stall', exact: true }).click();
  await expect(page.locator('#merchant-rowan')).toHaveAttribute('aria-pressed', 'true');
  await click('bram');
  await page.getByRole('button', { name: 'Visit stall', exact: true }).click();
  await expect(page.locator('#merchant-bram')).toHaveAttribute('aria-pressed', 'true');
  // Daily caps stop these clicks before an action, while still exercising the map targets.
  await page.route('**/api/state', async route => {
    const response = await route.fetch(), state = await response.json();
    delete state.batch_limit;delete state.alchemist;
    for (const item of state.catalog) if (item.kind === 'ingredient') item.gathered_today = item.gather_cap;
    return route.fulfill({ json: state });
  });
  await page.getByRole('button', { name: 'Refresh ledger', exact: true }).click();
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  for (const id of ['sunleaf', 'moonmint', 'emberbloom', 'spring_water', 'wood_essence', 'silver_dust']) {
    await click(id);
    await expect(page.locator('#interaction-detail')).toContainText('This save has collected');
    await expect(page.locator('#interaction-confirm')).toBeDisabled();
    await page.getByRole('button', {name: 'Leave', exact: true}).click();
    await page.getByRole('button', { name: 'Refresh ledger', exact: true }).click();
    await expect(page.locator('#action-status')).not.toContainText('This save has collected');
  }
  await page.screenshot({ path: '.local/redesigned-market-desktop.png', fullPage: true });
  expect(writes).toEqual([]); expect(errors).toEqual([]); expect(failed).toEqual([]);
});

test('normal-speed walking crosses the steps, interacts on arrival and rejects a blocked destination', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'magician'));
  const writes: string[] = [];
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  const bounds = (await canvas.boundingBox())!;
  const click = (x: number, y: number) => canvas.click({ position: { x: x * bounds.width / WORLD.width, y: y * bounds.height / WORLD.height } });
  await click(...spots.find(s => s.id === 'cauldron')!.at);
  await page.getByRole('button', { name: 'Choose a recipe', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A little careful brewing' })).toBeVisible();
  await expect(canvas).toHaveAttribute('aria-label', /Shop floor/);
  await canvas.screenshot({ path: '.local/isometric-inside-shop.png' });
  await click(...WORLD.spawn);
  await expect(canvas).toHaveAttribute('aria-label', /Courtyard/);
  await click(440, 365);
  await expect(page.locator('#map-status')).toContainText('blocked');
  await expect(canvas).toHaveAttribute('aria-label', /Courtyard/);
  expect(writes).toEqual([]);
});

test('the Goblin stays fully visible around a flower bed and cannot stand inside its edge', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'goblin'));
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Goblin/);
  const bounds = (await canvas.boundingBox())!;
  const click = (x: number, y: number) => canvas.click({ position: { x: x * bounds.width / WORLD.width, y: y * bounds.height / WORLD.height } });
  await click(942, 683);
  await expect(page.locator('#map-status')).toContainText('blocked');
  // The enlarged portal occupies the former(890,760) click; use open paving beside it.
  for (const point of [[1005, 702], [850, 520], [720, 690], [1040, 920]]) {
    await click(point[0], point[1]);
    await canvas.screenshot({ path: `.local/town-actor-${point[0]}-${point[1]}.png` });
    const visible = await canvas.evaluate(async (element, { point, actor }) => {
      await new Promise(requestAnimationFrame);
      const actual = (element as HTMLCanvasElement).getContext('2d')!;
      const image = new Image(); image.src = '/assets/characters/goblin.png'; await image.decode();
      const reference = document.createElement('canvas'); reference.width = actual.canvas.width; reference.height = actual.canvas.height;
      const expected = reference.getContext('2d')!; expected.imageSmoothingEnabled = false;
      const left = Math.floor(point[0] - actor.frame / 2 * actor.scale), top = Math.floor(point[1] - actor.feet * actor.scale), size = Math.ceil(actor.frame * actor.scale);
      // Phaser's roundPixels Canvas path expands each source frame by half a pixel.
      expected.setTransform(actor.scale, 0, 0, actor.scale, point[0], point[1]);
      expected.drawImage(image, 0, 0, actor.frame, actor.frame, -actor.frame / 2, -actor.feet, actor.frame + .5, actor.frame + .5);
      const a = actual.getImageData(left, top, size, size).data, b = expected.getImageData(left, top, size, size).data;
      // Compare visible sprite area, allowing the scaled canvas click's fractional pixel phase.
      const color = (data: Uint8ClampedArray, i: number) => data[i] * 65536 + data[i + 1] * 256 + data[i + 2];
      const palette = new Set<number>(); let samples = 0, matched = 0;
      for (let i = 0; i < b.length; i += 4) if (b[i + 3] === 255) { palette.add(color(b, i)); samples++; }
      for (let i = 0; i < a.length; i += 4) if (palette.has(color(a, i))) matched++;
      return { ratio: matched / samples, samples };
    }, { point, actor: ACTOR });
    expect(visible.samples).toBeGreaterThan(2000);
    expect(visible.ratio, `Sprite hidden at ${point}`).toBeGreaterThan(.97);
  }
  await canvas.screenshot({ path: '.local/town-actors-visible.png' });
});
