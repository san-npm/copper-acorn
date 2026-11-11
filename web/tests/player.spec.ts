import { test, expect, type Page } from './legacy';
import { createHash } from 'node:crypto';
import { WORLD, spots } from '../src/isometric-layout';

const names = ['Goblin', 'Magician', 'Dwarf', 'Liche', 'Lizardman', 'Vampire', 'Elf', 'Dark Elf'];
const id = '10000000-0000-4000-8000-000000000001';

async function account(page: Page, character: unknown) {
  const user = { id, aud: 'authenticated', role: 'authenticated', user_metadata: { character_id: character } };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = ['header', Buffer.from(JSON.stringify({ sub: id, exp: expires, role: 'authenticated' })).toString('base64url'), 'simulated'].join('.');
  await page.addInitScript(({ token, expires, user }) => {
    if (!sessionStorage.getItem('test-signed-out')) localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'simulated-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }));
  }, { token, expires, user });
  const methods: string[] = [];
  const state=await(await page.request.get('/api/state')).json();delete state.batch_limit;delete state.alchemist;
  const world='20000000-0000-4000-8000-000000000001',wallet='ca-'+world.replaceAll('-','')+'.testnet';
  Object.assign(state.environment,{network:'testnet',world_id:world});state.player.account_id=wallet;
  await page.route('https://example.supabase.co/functions/v1/game-session', route => {
    methods.push(route.request().method());
    return route.fulfill({ json: { world: { id: world, status: 'ready' },wallet:{account_id:wallet,funded_at:'2026-11-05T00:00:00Z'} } });
  });
  await page.route('https://example.supabase.co/functions/v1/game-api/state*',route=>route.fulfill({json:state}));
  await page.route('https://example.supabase.co/functions/v1/game-api/saves*',route=>route.fulfill({json:{saves:[{world_id:world,is_active:true,alchemist:null}],limit:2}}));
  await page.route('https://example.supabase.co/auth/v1/logout**', route => route.fulfill({ status: 204, body: '' }));
  return { user, methods, token };
}

async function enterSavedGame(page:Page){
  await expect(page.locator('#network-label')).toContainText('Saved shop');
  await expect(page.locator('#character-status')).not.toContainText('Restoring your character');
  if(await page.locator('#character-dialog').evaluate((dialog:HTMLDialogElement)=>dialog.open))await page.locator('#cancel-character').click();
  await page.getByRole('button',{name:'Continue game',exact:true}).click();
}

test('first visit selects all eight in the actual map, preserves inventory and restores a local choice', async ({ page }) => {
  const errors: string[] = [], writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.method() !== 'GET') writes.push(req.url()); });
  await page.goto('/');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(8);
  await expect(page.locator('#copper')).not.toHaveText('—');
  const copper = await page.locator('#copper').textContent();
  const canvas = page.locator('#game canvas');
  const drawings = new Set<string>();
  for (const name of names) {
    if (!(await dialog.isVisible())) await page.getByRole('button', { name: 'Choose character', exact: true }).click();
    await dialog.getByRole('radio', { name, exact: true }).check();
    await page.getByRole('button', { name: 'Use this character', exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(canvas).toHaveAttribute('aria-label', new RegExp(`Isometric pixel market\\. ${name}\\.`));
    drawings.add(createHash('sha256').update(await canvas.screenshot()).digest('hex'));
    await expect(page.locator('#copper')).toHaveText(copper!);
  }
  expect(drawings.size).toBe(8);
  await page.reload();
  await expect(canvas).toHaveAttribute('aria-label', /Dark Elf/);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('#character-status')).toContainText('Saved in this browser');
  await page.screenshot({ path: '.local/player-shop-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 800 });
  await page.getByRole('button', { name: 'Choose character', exact: true }).click();
  await expect(dialog.getByRole('radio', { name: 'Dark Elf', exact: true })).toBeChecked();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: '.local/player-picker-mobile.png' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Choose character', exact: true })).toBeFocused();
  expect(errors).toEqual([]); expect(writes).toEqual([]);
});

test('account appearance saves only cosmetic metadata, restores the fresh profile and preserves unrelated metadata (simulated Auth)', async ({ page }) => {
  const fixture = await account(page, undefined);
  const user = { ...fixture.user, user_metadata: { character_id: undefined as string | undefined, nickname: 'fixture-alchemist' } };
  let saves = 0;
  await page.route('https://example.supabase.co/auth/v1/user', route => {
    if (route.request().method() === 'PUT') {
      expect(route.request().headers().authorization).toBe(`Bearer ${fixture.token}`);
      expect(route.request().postDataJSON()).toEqual({ data: { character_id: 'lizard' } });
      user.user_metadata.character_id = 'lizard'; saves++;
    }
    return route.fulfill({ json: user });
  });
  await page.goto('/');
  await enterSavedGame(page);
  await page.getByRole('button',{name:'Choose character',exact:true}).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('radio', { name: 'Lizardman', exact: true }).check();
  await page.getByRole('button', { name: 'Use this character', exact: true }).click();
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Lizardman/);
  await expect(page.locator('#character-status')).toHaveText('Saved with your account');
  await expect(page.locator('#account-status')).toContainText('Your saved shop is ready');
  expect(saves).toBe(1); expect(fixture.methods).toEqual(['GET']);
  expect(user.user_metadata.nickname).toBe('fixture-alchemist');
  expect(await page.evaluate(() => localStorage.getItem('copper-acorn.sandbox-character'))).toBeNull();
  await page.reload();
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Lizardman/);
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(saves).toBe(1); expect(fixture.methods).toEqual(['GET', 'GET']);
});

test('failed saves keep the old character; a delayed save cannot restore a signed-out account (simulated Auth)', async ({ page }) => {
  const { user } = await account(page, 'magician');
  let fail = true, release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saving = new Promise<void>(resolve => { started = resolve; });
  await page.route('https://example.supabase.co/auth/v1/user', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: user });
    if (fail) return route.fulfill({ status: 503, json: { error: 'simulated failure' } });
    started(); await gate;
    return route.fulfill({ json: { ...user, user_metadata: { character_id: 'goblin' } } });
  });
  await page.goto('/');
  await enterSavedGame(page);
  await expect(page.locator('#character-name')).toHaveText('Magician');
  await page.getByRole('button', { name: 'Choose character', exact: true }).click();
  await page.getByRole('radio', { name: 'Goblin', exact: true }).check();
  await page.getByRole('button', { name: 'Use this character', exact: true }).click();
  await expect(page.locator('#character-note')).toContainText('displayed character has not changed');
  await expect(page.locator('#character-name')).toHaveText('Magician');
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Magician/);
  fail = false;
  await page.getByRole('button', { name: 'Use this character', exact: true }).click();
  await saving;
  // A second tab can sign out while this tab's modal is saving.
  await page.evaluate(() => {
    sessionStorage.setItem('test-signed-out', 'true');
    localStorage.removeItem('sb-example-auth-token');
    new BroadcastChannel('sb-example-auth-token').postMessage({ event: 'SIGNED_OUT', session: null });
  });
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('#account-signout')).toBeHidden();
  const completed=page.waitForResponse(response=>response.url().endsWith('/auth/v1/user')&&response.request().method()==='PUT'&&response.status()===200);
  release();
  await completed;
  await expect(page.locator('#account-signout')).toBeHidden();
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /No character selected/);
  await expect(page.locator('#character-name')).toHaveText('Choose your alchemist');
  await expect(page.locator('#character-status')).not.toContainText('Saved with your account');
});

test('invalid saved IDs are ignored; unavailable sheets cannot replace the saved choice', async ({ page }) => {
  await page.addInitScript(() => { if (!localStorage.getItem('copper-acorn.sandbox-character')) localStorage.setItem('copper-acorn.sandbox-character', '../../other'); });
  await page.route('**/assets/characters/lizard.png', route => route.abort('failed'));
  await page.goto('/');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Lizardman', exact: true })).toBeDisabled();
  await page.getByRole('radio', { name: 'Liche', exact: true }).check();
  await page.getByRole('button', { name: 'Use this character', exact: true }).click();
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Liche/);
  await page.reload();
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /Liche/);
  expect(await page.evaluate(() => localStorage.getItem('copper-acorn.sandbox-character'))).toBe('skeleton');
});

test('signing out closes a resource prompt and clears its selected action (simulated Auth)', async ({ page }) => {
  const fixture = await account(page, 'magician');
  await page.route('https://example.supabase.co/auth/v1/user', route => route.fulfill({json: fixture.user}));
  const writes: string[] = [];
  page.on('request', request => { if (request.method()==='POST' && new URL(request.url()).pathname.endsWith('/action')) writes.push(request.url()); });
  await page.goto('/');
  await enterSavedGame(page);
  const canvas=page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  const bounds=(await canvas.boundingBox())!, spot=spots.find(s=>s.id==='sunleaf')!;
  await canvas.click({position:{x:spot.at[0]*bounds.width/WORLD.width,y:spot.at[1]*bounds.height/WORLD.height}});
  await expect(page.locator('#interaction-dialog')).toBeVisible();
  await page.evaluate(()=>{
    sessionStorage.setItem('test-signed-out','true');
    localStorage.removeItem('sb-example-auth-token');
    new BroadcastChannel('sb-example-auth-token').postMessage({event:'SIGNED_OUT',session:null});
  });
  await expect(page.locator('#interaction-dialog')).not.toBeVisible();
  await expect(page.locator('#character-name')).toHaveText('Choose your alchemist');
  await page.locator('#interaction-confirm').evaluate((button:HTMLButtonElement)=>button.click());
  expect(writes).toEqual([]);
});

test('unavailable local storage reports a failed save without adopting the preview', async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === 'copper-acorn.sandbox-character') throw new DOMException('simulated quota', 'QuotaExceededError');
      return original.call(this, key, value);
    };
  });
  await page.goto('/');
  await page.getByRole('radio', { name: 'Vampire', exact: true }).check();
  await page.getByRole('button', { name: 'Use this character', exact: true }).click();
  await expect(page.locator('#character-note')).toContainText('Save could not be confirmed');
  await expect(page.locator('#character-name')).toHaveText('Choose your alchemist');
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label', /No character selected/);
});

test('keyboard movement uses the chosen sprite in four directions and pauses inside the picker', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'magician'));
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  const copper = await page.locator('#copper').textContent();
  let last = await canvas.screenshot();
  for (const [direction, key] of Object.entries({ south: 'ArrowDown', west: 'ArrowLeft', east: 'ArrowRight', north: 'ArrowUp' })) {
    await canvas.focus(); await page.keyboard.down(key);
    await expect.poll(async () => (await canvas.screenshot()).equals(last)).toBe(false);
    await canvas.screenshot({ path: `.local/player-walk-${direction}.png` });
    await page.keyboard.up(key);
    last = await canvas.screenshot();
  }
  await page.getByRole('button', { name: 'Choose character', exact: true }).click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const screenshot = () => canvas.screenshot({ style: '#character-dialog{visibility:hidden}#character-dialog::backdrop{background:transparent}' });
  const paused = await screenshot();
  await page.keyboard.down('w');
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await screenshot()).equals(paused)).toBe(true);
  await page.keyboard.up('w'); await page.keyboard.press('Escape');
  await expect(page.locator('#copper')).toHaveText(copper!);
});

test('same-account Auth notifications preserve a pending shop trade (simulated Auth and testnet)', async ({ page, request }) => {
  const fixture = await account(page, 'magician');
  const state = await (await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  const world = '20000000-0000-4000-8000-000000000001', wallet = `ca-${world.replaceAll('-', '')}.testnet`;
  state.environment.network = 'testnet'; state.environment.world_id = world;
  state.player.balances.copper = '40'; state.player.balances.sunleaf = '4'; state.player.balances.spring_water = '3';
  state.pending_operation = null;
  await page.route('https://example.supabase.co/functions/v1/game-session', route => {
    fixture.methods.push(route.request().method());
    return route.fulfill({ json: { world: { id: world, status: 'ready' }, wallet: { account_id: wallet, funded_at: '2026-11-05T00:00:00Z' } } });
  });
  await page.route('https://example.supabase.co/auth/v1/user', route => route.fulfill({ json: fixture.user }));
  let started!: () => void, release!: () => void, reads = 0;
  const sent = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://example.supabase.co/functions/v1/game-api/**', async route => {
    if(new URL(route.request().url()).pathname.endsWith('/saves'))return route.fulfill({json:{saves:[{world_id:world,is_active:true,alchemist:null}],limit:2}});
    if (route.request().url().endsWith('/state')) { reads++; return route.fulfill({ json: state }); }
    expect(route.request().postDataJSON().action).toEqual({ kind: 'brew', token_id: 'healing_tonic' });
    started(); await gate;
    state.player.balances.copper = '39';
    return route.fulfill({ json: { status: 'confirmed', result: { hash: 'simulated-receipt' } } });
  });
  await page.goto('/');
  await enterSavedGame(page);
  await expect(page.locator('#copper')).toHaveText('40');
  await page.getByRole('button', { name: 'Cauldron', exact: true }).click();
  await page.getByRole('button', { name: 'Brew Healing Tonic', exact: true }).click();
  await sent;
  fixture.user.user_metadata.character_id = 'elf';
  await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem('sb-example-auth-token')!);
    new BroadcastChannel('sb-example-auth-token').postMessage({ event: 'USER_UPDATED', session });
  });
  await expect(page.locator('#character-name')).toHaveText('Elf');
  await expect(page.locator('#copper')).toHaveText('40');
  await expect(page.locator('#brew-healing_tonic')).toBeDisabled();
  expect(fixture.methods).toEqual(['GET']); expect(reads).toBe(1);
  release();
  await expect(page.locator('#copper')).toHaveText('39');
  await expect(page.locator('#action-status')).toContainText('Confirmed');
});

test('an account switch cancels a walking interaction before it can act in the new shop (simulated)', async ({ page, request }) => {
  const fixture = await account(page, 'magician');
  const state = await (await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  state.environment.network = 'testnet'; state.pending_operation = null;
  const second = { ...fixture.user, id: '10000000-0000-4000-8000-000000000002', user_metadata: { character_id: 'goblin' } };
  let active = fixture.user;
  const world = () => active.id.endsWith('2') ? '20000000-0000-4000-8000-000000000002' : '20000000-0000-4000-8000-000000000001';
  await page.route('https://example.supabase.co/auth/v1/user', route => route.fulfill({ json: active }));
  await page.route('https://example.supabase.co/functions/v1/game-session', route => route.fulfill({ json: { world: { id: world(), status: 'ready' }, wallet: { account_id: `ca-${world().replaceAll('-', '')}.testnet`, funded_at: '2026-11-05T00:00:00Z' } } }));
  const actions: unknown[] = [];
  await page.route('https://example.supabase.co/functions/v1/game-api/**', route => {
    if(new URL(route.request().url()).pathname.endsWith('/saves'))return route.fulfill({json:{saves:[{world_id:world(),is_active:true,alchemist:null}],limit:2}});
    if (route.request().url().endsWith('/state')) return route.fulfill({ json: { ...state, environment: { ...state.environment, world_id: world() } } });
    actions.push(route.request().postDataJSON());
    return route.fulfill({ status: 409, json: { error: 'This fixture must not submit actions.' } });
  });
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await enterSavedGame(page);
  const canvas = page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label', /Magician/);
  await expect(page.locator('#network-label')).toContainText('Saved shop');
  const bounds = (await canvas.boundingBox())!, tap = spots.find(s => s.id === 'wood_essence')!;
  await canvas.click({ position: { x: tap.at[0] * bounds.width / WORLD.width, y: tap.at[1] * bounds.height / WORLD.height } });
  active = second;
  await page.evaluate(user => {
    const session = JSON.parse(localStorage.getItem('sb-example-auth-token')!);
    session.user = user;
    session.access_token = 'header.' + btoa(JSON.stringify({ sub: user.id, exp: session.expires_at, role: 'authenticated' })) + '.simulated';
    localStorage.setItem('sb-example-auth-token', JSON.stringify(session));
    new BroadcastChannel('sb-example-auth-token').postMessage({ event: 'SIGNED_IN', session });
  }, second);
  await expect(canvas).toHaveAttribute('aria-label', /Goblin/);
  await expect(page.locator('#account-status')).toContainText('Your saved shop is ready');
  await page.waitForTimeout(4500);
  expect(actions).toEqual([]);
});
