import {test,expect} from './legacy';

test('the cabinets display listed stock across their rows, cap visible bottles and clear sold or unlisted goods',async({page,request})=>{
  const state=await(await request.get('/api/state')).json();
  delete state.batch_limit;delete state.alchemist;
  state.listings=[];
  let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
  await page.route('**/api/state',r=>r.fulfill({json:state}));
  await page.goto('/');
  const canvas=page.locator('#game canvas');
  await expect(canvas).toHaveAttribute('aria-label',/Cabinets: empty/);
  const pixels=()=>canvas.evaluate(async element=>{
    await new Promise(requestAnimationFrame);
    const context=(element as HTMLCanvasElement).getContext('2d')!;
    return [[555,94,102,40],[555,137,102,60],[555,180,102,60],[680,174,100,65]].map(([x,y,w,h])=>{
      let hash=2166136261;for(const byte of context.getImageData(x,y,w,h).data)hash=Math.imul(hash^byte,16777619);return hash>>>0;
    });
  });
  const empty=await pixels();
  state.player.balances.healing_tonic='9';state.player.balances.focus_draught='2';
  state.listings=[{token_id:'healing_tonic',price:'13'},{token_id:'focus_draught',price:'22'}];
  await page.locator('#refresh').click();
  await expect(canvas).toHaveAttribute('aria-label',/Cabinets: 9 Healing Tonic, 2 Focus Draught/);
  const stocked=await pixels();stocked.forEach((hash,index)=>expect(hash).not.toBe(empty[index]));
  await canvas.screenshot({path:'.local/town-stocked-cabinets.png'});
  state.player.balances.healing_tonic='12';await page.locator('#refresh').click();
  await expect(canvas).toHaveAttribute('aria-label',/12 Healing Tonic/);
  expect(await pixels()).toEqual(stocked);
  state.player.balances.healing_tonic='1';state.player.balances.focus_draught='0';
  state.listings=[{token_id:'healing_tonic',price:'13'}];await page.locator('#refresh').click();
  await expect(canvas).toHaveAttribute('aria-label',/Cabinets: 1 Healing Tonic/);
  const one=await pixels();expect(one[0]).toBe(empty[0]);expect(one[1]).not.toBe(empty[1]);expect(one[3]).toBe(empty[3]);
  state.player.balances.healing_tonic='0';state.listings=[];await page.locator('#refresh').click();
  await expect(canvas).toHaveAttribute('aria-label',/Cabinets: empty/);expect(await pixels()).toEqual(empty);
  state.player.balances.healing_tonic='9';await page.locator('#refresh').click();
  await expect(page.locator('[data-owned="healing_tonic"]')).toHaveText('9');expect(await pixels()).toEqual(empty);
  expect(writes).toBe(0);
});

test('the town interface loads its local pixel font and dialogs fit narrow screens',async({page})=>{
  const external:string[]=[],errors:string[]=[];
  page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).origin!=='http://127.0.0.1:5174')external.push(r.url());});
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
  await page.goto('/');await page.evaluate(()=>document.fonts.ready);
  expect(await page.evaluate(()=>document.fonts.check('18px "Pixelify Sans"'))).toBe(true);
  await page.setViewportSize({width:320,height:800});
  await page.locator('#gather-spring_water').click();
  await expect(page.locator('#interaction-dialog')).toBeVisible();
  expect(await page.locator('#interaction-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await page.screenshot({path:'.local/town-ui-mobile-dialog.png'});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Choose character',exact:true}).click();
  await page.getByRole('radio',{name:'Lizardman',exact:true}).check();
  expect(await page.locator('#character-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBe(320);
  expect(external).toEqual([]);expect(errors).toEqual([]);
});
