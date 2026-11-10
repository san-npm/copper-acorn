import { test, expect,openAccount } from './legacy';
import type { GameState } from '../src/types';
import { WORLD, spots } from '../src/isometric-layout';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('copper-acorn.sandbox-character', 'magician'));
  await page.route('https://example.supabase.co/auth/v1/user', route => route.fulfill({ json: {
    id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated', user_metadata: { character_id: 'magician' },
  } }));
});

test('opening shop loop settles on the local chain and recovers a lost response once', async ({ page, request }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (!req.url().startsWith('http://127.0.0.1:5174')) external.push(req.url()); });
  await page.goto('/');
  await expect(page.locator('#copper')).toHaveText('40');
  await expect(page.locator('#network-label')).toContainText('Practice shop');
  await expect(page.locator('#game canvas')).toBeVisible();
  await expect(page.locator('#choose-character')).toBeEnabled();
  // Scene construction precedes its first painted frame.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const cabinetPixels = () => page.locator('#game canvas').evaluate(canvas => {
    const pixels = (canvas as HTMLCanvasElement).getContext('2d')!.getImageData(558, 82, 102, 113).data;
    let hash = 2166136261;
    for (const byte of pixels) hash = Math.imul(hash ^ byte, 16777619);
    return hash >>> 0;
  });
  const emptyCabinet = await cabinetPixels();
  await page.getByRole('button', { name: 'Cauldron', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Brew Healing Tonic', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#copper')).toHaveText('39');
  await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('1');
  await expect(page.locator('#brew-healing_tonic')).toBeFocused();
  await page.getByRole('button', { name: 'Shelves', exact: true }).click();
  await page.getByLabel('Price in Copper').fill('13');
  await page.getByRole('button', { name: 'Put on shelf', exact: true }).click();
  await expect(page.locator('.shelf-slot.stocked')).toContainText('13 Copper');
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label',/Cabinets: 1 Healing Tonic/);
  await expect.poll(cabinetPixels).not.toBe(emptyCabinet);
  await page.locator('#game canvas').screenshot({ path: '.local/isometric-stocked-shelf.png' });
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await page.getByRole('button', { name: 'Serve gardener · 13 Copper', exact: true }).click();
  await expect(page.locator('#copper')).toHaveText('52');
  await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('0');
  await expect(page.locator('#game canvas')).toHaveAttribute('aria-label',/Cabinets: empty/);
  await expect.poll(cabinetPixels).toBe(emptyCabinet);
  await expect(page.locator('#serve')).toBeDisabled();
  await page.locator('#refill').click();
  await expect(page.locator('#copper')).toHaveText('42');
  await expect(page.locator('#refill')).toBeEnabled();
  const afterRefill: GameState = await (await request.get('/api/state')).json();
  expect(BigInt(afterRefill.environment.native_balance)).toBeGreaterThan(BigInt(afterRefill.environment.starter_native));
  expect(afterRefill.world.native_pool).toBe('900000000000000000000000');
  await page.reload();
  await expect(page.locator('#copper')).toHaveText('42');

  await page.route('**/api/action', async route => {
    const response = await route.fetch();
    expect((await response.json()).status).toBe('confirmed');
    await route.abort('failed');
  }, { times: 1 });
  await page.locator('[data-gather="moonmint"]').click();
  await page.getByRole('button', {name: 'Harvest Moonmint', exact: true}).click();
  await expect(page.locator('#action-status')).toContainText('Refresh ledger');
  await expect(page.locator('[data-gather="moonmint"]')).toBeDisabled();
  await page.getByRole('button', { name: 'Refresh ledger', exact: true }).click();
  await expect(page.locator('[data-owned="moonmint"]')).toHaveText('2');
  await expect(page.locator('[data-gather="moonmint"]')).toBeEnabled();
  expect(await page.evaluate(() => sessionStorage.getItem('copper-acorn.pending'))).toBeNull();

  await page.getByRole('button', { name: 'Market', exact: true }).click();
  await page.locator('#buy-mira-sunleaf').click();
  await expect(page.locator('#copper')).toHaveText('38');
  await page.locator('#sell-mira-sunleaf').click();
  await expect(page.locator('#copper')).toHaveText('40');
  await page.locator('.market-item').first().getByText('Why this price?', { exact: true }).click();
  await expect(page.locator('.price-reason').first()).toContainText('Stock 10 / target 10');
  for (let i = 0; i < 3; i++) {
    await page.locator('#gather-moonmint').click();
    await page.getByRole('button', {name: 'Harvest Moonmint', exact: true}).click();
    await expect(page.locator('[data-owned="moonmint"]')).toHaveText(String(i + 3));
    await expect(page.locator('#action-status')).toContainText('Confirmed.');
  }
  await expect(page.locator('#gather-moonmint')).toBeDisabled();
  const canvas = (await page.locator('#game canvas').boundingBox())!;
  const mint = spots.find(spot => spot.id === 'moonmint')!;
  await page.locator('#game canvas').click({ position: { x: mint.at[0] * canvas.width / WORLD.width, y: mint.at[1] * canvas.height / WORLD.height } });
  await expect(page.locator('#interaction-detail')).toContainText('patch needs until the next market day');
  await expect(page.locator('#interaction-confirm')).toBeDisabled();
  await page.getByRole('button', {name: 'Leave', exact: true}).click();
  expect(await page.evaluate(() => sessionStorage.getItem('copper-acorn.pending'))).toBeNull();
  await page.screenshot({ path: '.local/shop-market.png', fullPage: true });
  await page.getByRole('button', { name: 'Shelves', exact: true }).click();
  await page.screenshot({ path: '.local/shop-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#copper')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.local/shop-mobile.png', fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('local API rejects foreign origins and duplicate IDs cannot duplicate a gather', async ({ request }) => {
  const foreign = await request.post('/api/action', { headers: { Origin: 'https://example.com' }, data: {} });
  expect(foreign.status()).toBe(403);
  const before: GameState = await (await request.get('/api/state')).json();
  const unknown = await request.post('/api/action', { data: { request_id: crypto.randomUUID(), world_id: before.environment.world_id, action: { kind: 'mint' } } });
  expect(unknown.status()).toBe(422);
  const action = { request_id: crypto.randomUUID(), world_id: before.environment.world_id, action: { kind: 'gather', token_id: 'sunleaf' } };
  const first = await (await request.post('/api/action', { data: action })).json();
  const second = await (await request.post('/api/action', { data: action })).json();
  expect(first.status).toBe('confirmed');
  expect(second).toEqual(first);
  const conflict = await request.post('/api/action', { data: { ...action, action: { kind: 'gather', token_id: 'spring_water' } } });
  expect(conflict.status()).toBe(409);
  const after: GameState = await (await request.get('/api/state')).json();
  expect(BigInt(after.player.balances.sunleaf) - BigInt(before.player.balances.sunleaf)).toBe(1n);
  expect(BigInt(after.catalog.find(i => i.token_id === 'sunleaf')!.gathered_today) - BigInt(before.catalog.find(i => i.token_id === 'sunleaf')!.gathered_today)).toBe(1n);
});

test('disabled Google provider explains setup without starting OAuth or saving an account', async ({ page }) => {
  const writes: string[] = [];
  page.on('request', req => { if (req.method() === 'POST' && req.url().includes('supabase.co')) writes.push(req.url()); });
  await page.route('https://example.supabase.co/auth/v1/settings', route => route.fulfill({ json: { external: { google: false } } }));
  await page.goto('/');
  await openAccount(page);
  await page.getByText('Development session', { exact: true }).click();
  await page.getByRole('button', { name: 'Check account setup', exact: true }).click();
  await expect(page.locator('#account-status')).toContainText('Google login needs owner setup');
  await expect(page.getByRole('button', { name: 'Continue with Google', exact: true })).toBeDisabled();
  await expect(page.locator('#account-save')).toBeHidden();
  expect(writes).toEqual([]);
});

test('enabled Google starts PKCE with this game as the return URL (simulated provider)', async ({ page }) => {
  await page.route('https://example.supabase.co/auth/v1/settings', route => route.fulfill({ json: { external: { google: true } } }));
  await page.route('https://example.supabase.co/auth/v1/authorize?*', route => route.abort());
  await page.goto('/');
  await openAccount(page);
  await page.getByText('Development session', { exact: true }).click();
  await page.getByRole('button', { name: 'Check account setup', exact: true }).click();
  await expect(page.locator('#account-signin')).toBeEnabled();
  const request = page.waitForRequest('https://example.supabase.co/auth/v1/authorize?*');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  const url = new URL((await request).url());
  expect(url.searchParams.get('provider')).toBe('google');
  expect(url.searchParams.get('redirect_to')).toBe('http://127.0.0.1:5174/');
  expect(url.searchParams.get('code_challenge_method')).toBe('s256');
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test('late account responses cannot restore signed-out identity in the UI (simulated session)', async ({ page }) => {
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' })).toString('base64url'), 'simulated-signature'].join('.');
  await page.addInitScript(({ token, expires, user }) => {
    localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'simulated-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user }));
  }, { token, expires, user });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://example.supabase.co/functions/v1/game-session', async route => {
    await gate;
    await route.fulfill({ json: { world: { id: 'simulated-world', status: 'pending' } } });
  });
  await page.route('https://example.supabase.co/auth/v1/logout?scope=local', route => route.fulfill({ status: 204 }));
  try {
    await page.goto('/');
    await openAccount(page);
    await expect(page.locator('#account-signout')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.locator('#account-signout')).toBeHidden();
    release();
    await expect(page.locator('#account-check')).toBeEnabled();
    await expect(page.locator('#account-status')).toContainText('Not signed in');
    await expect(page.locator('#account-save')).toBeHidden();
  } finally { release(); await page.unrouteAll({behavior:'wait'}); }
});

test('restored Google session checks an existing managed wallet without allocating one (simulated)', async ({ page }) => {
  const user = { id: '10000000-0000-4000-8000-000000000001', aud: 'authenticated', role: 'authenticated' };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: user.id, exp: expires, role: 'authenticated' })).toString('base64url'), 'simulated-signature'].join('.');
  await page.addInitScript(({ token, expires, user }) => localStorage.setItem('sb-example-auth-token', JSON.stringify({ access_token: token, refresh_token: 'simulated-refresh', expires_at: expires, expires_in: 3600, token_type: 'bearer', user })), { token, expires, user });
  const methods: string[] = [];
  const account = 'ca-20000000000040008000000000000001.testnet';
  await page.route('https://example.supabase.co/functions/v1/game-session', route => {
    methods.push(route.request().method());
    if (route.request().method() === 'POST') expect(route.request().postDataJSON()).toEqual({});
    return route.fulfill({ json: { world: { id: 'test-world', status: 'ready' }, wallet: { account_id: account, funded_at: '2026-11-05T00:00:00Z', funding_requested_at: '2026-11-05T00:00:00Z' } } });
  });
  await page.route('https://example.supabase.co/auth/v1/settings', route => route.fulfill({ json: { external: { google: true } } }));
  await page.route('https://example.supabase.co/functions/v1/game-api/**', route => route.fulfill({ status: 503, json: { error: 'No live API is used in this simulated account check.' } }));
  await page.goto('/');
  await openAccount(page);
  await expect(page.locator('#account-status')).toContainText('Your saved shop is ready');
  await expect(page.locator('#account-wallet-id')).toHaveText(account);
  expect(methods).toEqual(['GET']);
  await page.getByRole('button', { name: 'Check account setup', exact: true }).click();
  await expect.poll(() => methods).toEqual(['GET', 'GET']);
  await expect(page.locator('#account-save')).toBeHidden();
});

test('selected shop setup stays isolated and read-only until activation (simulated testnet)',async({page,request})=>{
  const world='20000000-0000-4000-8000-000000000002',account='ca-'+world.replaceAll('-','')+'.testnet';
  const user={id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',role:'authenticated',user_metadata:{character_id:'goblin'}};
  const expires=Math.floor(Date.now()/1000)+3600;
  const token=['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires})).toString('base64url'),'simulated'].join('.');
  await page.addInitScript(({user,expires,token})=>localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated',expires_at:expires,expires_in:3600,token_type:'bearer',user})),{user,expires,token});
  const state=await(await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  Object.assign(state.environment,{network:'testnet',world_id:world,is_active:false});
  Object.assign(state.player.balances,{copper:'40',sunleaf:'4',spring_water:'3'});state.player.account_id=account;
  const calls:string[]=[];let writes=0;
  await page.route('https://example.supabase.co/auth/v1/user',r=>r.fulfill({json:user}));
  await page.route('https://example.supabase.co/functions/v1/game-session**',r=>{
    expect(new URL(r.request().url()).searchParams.get('world_id')).toBe(world);
    return r.fulfill({json:{world:{id:world,status:'pending',is_active:false},wallet:{account_id:account,funded_at:'2026-11-05T00:00:00Z'}}});
  });
  await page.route('https://example.supabase.co/functions/v1/game-api/**',r=>{
    const url=new URL(r.request().url()),path=url.pathname.split('/game-api')[1];
    expect(url.searchParams.get('world_id')).toBe(world);calls.push(path);
    if(path==='/provision')return r.fulfill({json:{ready:true}});
    if(path==='/state')return r.fulfill({json:state});
    writes++;return r.abort();
  });
  await page.goto('/?world_id='+world);
  await openAccount(page);await expect(page.locator('#new-game')).toBeEnabled();expect(calls).not.toContain('/provision');
  await page.locator('#new-game').click();
  await expect(page.locator('#network-label')).toContainText('Shop preview');
  await expect(page.locator('#account-status')).toContainText('current shop remains active');
  expect(calls).toContain('/provision');
  if(await page.locator('#games-dialog').evaluate((d:HTMLDialogElement)=>d.open))await page.locator('#close-games').click();
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await expect(page.locator('#brew-healing_tonic')).toBeDisabled();await expect(page.locator('#gather-sunleaf')).toBeDisabled();await expect(page.locator('#refill')).toBeDisabled();
  state.environment.is_active=true;await page.locator('#refresh').click();
  await expect(page.locator('#network-label')).toContainText('Saved shop');await expect(page.locator('#brew-healing_tonic')).toBeEnabled();
  expect(writes).toBe(0);
});

test('shop selection survives the normal OAuth return and rejects malformed setup links',async({page})=>{
  const world='20000000-0000-4000-8000-000000000002';let setups=0;
  await page.route('https://example.supabase.co/auth/v1/settings',r=>r.fulfill({json:{external:{google:true}}}));
  await page.route('https://example.supabase.co/auth/v1/authorize?*',r=>r.abort());
  await page.route('https://example.supabase.co/functions/v1/game-session**',r=>{setups++;expect(new URL(r.request().url()).searchParams.get('world_id')).toBe(world);return r.fulfill({json:{world:null,wallet:null}});});
  await page.goto('/?world_id='+world);await openAccount(page);await page.locator('#account-check').click();
  const authorization=page.waitForRequest('https://example.supabase.co/auth/v1/authorize?*');
  await page.locator('#account-signin').click();
  expect(new URL((await authorization).url()).searchParams.get('redirect_to')).toBe('http://127.0.0.1:5174/');
  await page.goto('/');
  await expect(page).toHaveURL(new RegExp('world_id='+world));
  expect(await page.evaluate(()=>sessionStorage.getItem('copper-acorn.setup-world'))).toBeNull();
  await page.goto('/?world_id=invalid');await expect(page.locator('#account-status')).toContainText('setup link is invalid');
  await expect(page.locator('#account-signin')).toBeDisabled();expect(setups).toBe(0);
});

test('online shop restores server inventory and pending receipts across reload, then hides stock on sign-out (simulated testnet)', async ({ page, request }) => {
  const state = await (await request.get('http://127.0.0.1:3101/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  const world = '20000000-0000-4000-8000-000000000001';
  const account = 'ca-' + world.replaceAll('-', '') + '.testnet';
  state.environment.network = 'testnet'; state.environment.world_id = world;
  state.player.account_id = account; state.player.balances.copper = '40';
  state.player.balances.sunleaf = '4'; state.player.balances.spring_water = '3'; state.player.balances.healing_tonic = '0';
  state.pending_operation = null;
  const user = { id: '10000000-0000-4000-8000-000000000001', aud:'authenticated', role:'authenticated' };
  const expires = Math.floor(Date.now()/1000)+3600;
  const token = ['header',Buffer.from(JSON.stringify({sub:user.id,exp:expires,role:'authenticated'})).toString('base64url'),'simulated'].join('.');
  await page.addInitScript(({ token, expires, user }) => {
    if (!sessionStorage.getItem('test-signed-out')) localStorage.setItem('sb-example-auth-token',JSON.stringify({access_token:token,refresh_token:'simulated-refresh',expires_at:expires,expires_in:3600,token_type:'bearer',user}));
  }, {token,expires,user});
  await page.route('https://example.supabase.co/functions/v1/game-session', route=>route.fulfill({json:{world:{id:world,status:'ready'},wallet:{account_id:account,funded_at:'2026-11-05T00:00:00Z',funding_requested_at:'2026-11-05T00:00:00Z'}}}));
  const operations = new Map<string, any>(); let actions = 0;
  await page.route('https://example.supabase.co/functions/v1/game-api/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/game-api')[1];
    if(path==='/saves')return route.fulfill({json:{saves:[],limit:2}});
    if (path === '/state') return route.fulfill({json:state});
    if (path.startsWith('/actions/')) { state.pending_operation=null; return route.fulfill({json:operations.get(path.slice(9))}); }
    expect(path).toBe('/action');
    const body=route.request().postDataJSON();expect(body.world_id).toBe(world);
    if (!operations.has(body.request_id)) {
      actions++; expect(body.action).toEqual({kind:'brew',token_id:'healing_tonic'});
      state.player.balances.copper='39';state.player.balances.sunleaf='2';state.player.balances.spring_water='2';state.player.balances.healing_tonic='1';
      operations.set(body.request_id,{status:'confirmed',result:{hash:'simulated-testnet-receipt'},error:null});
      state.pending_operation={request_id:body.request_id,status:'pending'};
    }
    return route.abort('connectionreset');
  });
  await page.route('https://example.supabase.co/auth/v1/logout**',route=>route.fulfill({status:204,body:''}));
  let localWrites=0;
  page.on('request',r=>{if(new URL(r.url()).pathname==='/api/action')localWrites++;});
  await page.goto('/');
  await expect(page.locator('#network-label')).toContainText('Saved shop');
  await expect(page.locator('#copper')).toHaveText('40');
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await page.getByRole('button',{name:'Brew Healing Tonic',exact:true}).click();
  await expect(page.locator('#action-status')).toContainText('Refresh ledger');
  await page.reload();
  await expect(page.locator('#copper')).toHaveText('39');
  await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('1');
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await expect(page.locator('#serve')).toBeDisabled();
  await page.reload();
  await expect(page.locator('#copper')).toHaveText('39');
  expect(actions).toBe(1);expect(localWrites).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(()=>sessionStorage.setItem('test-signed-out','true'));
  await openAccount(page);await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await expect(page.locator('#copper')).toHaveText('—');
  await expect(page.locator('[data-owned="healing_tonic"]')).toHaveCount(0);
  await expect(page.locator('#network-label')).toContainText('Sign in');
});
