import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium,expect} from '@playwright/test';
import {spots,WORLD} from '../web/src/isometric-layout.ts';

const base=new URL(process.env.GAME_DEMO_URL||'http://127.0.0.1:5196');
assert.ok(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.port,'Use a disposable loopback demo.');
base.searchParams.set('owned','1');
const folder='.local/submission-demo';mkdirSync(folder,{recursive:true,mode:0o700});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1100},recordVideo:{dir:folder,size:{width:1440,height:1100}},reducedMotion:'reduce'});
const page=await context.newPage(),video=page.video(),errors=[];
page.on('pageerror',error=>errors.push(error.message));
let record;
try{
  await page.goto(base.href);
  await expect(page.locator('#new-game')).toBeEnabled({timeout:60_000});
  await page.locator('#new-game').click();
  await page.locator('#nickname').fill('Moss');
  await page.getByRole('radio',{name:'Goblin',exact:true}).check();
  await page.locator('#use-character').click();
  await expect(page.locator('#character-dialog')).not.toBeVisible();
  const world=await page.evaluate(()=>sessionStorage.getItem('copper-acorn.local-world'));
  assert.ok(world);
  const snapshot=async()=>{
    const response=await context.request.get(new URL('/api/state?world_id='+world,base).href);
    assert.equal(response.status(),200);return response.json();
  };
  const before=await snapshot();assert.equal(before.environment.player_owned,true);
  assert.equal(before.player.balances.copper,'40');
  await page.locator('#game canvas').screenshot({path:folder+'/town.png'});
  await page.waitForTimeout(1500);
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await page.locator('#brew-healing_tonic').click();
  await expect.poll(async()=>(await snapshot()).player.balances.healing_tonic,{timeout:30_000}).toBe('1');
  await page.getByRole('button',{name:'Shelves',exact:true}).click();
  await page.getByLabel('Price in Copper').fill('13');
  await page.locator('#list').click();
  await expect.poll(async()=>(await snapshot()).listings.length,{timeout:30_000}).toBe(1);
  await page.getByRole('button',{name:'Customers',exact:true}).click();
  await page.locator('#serve').click();
  await expect.poll(async()=>(await snapshot()).player.balances.copper,{timeout:30_000}).toBe('52');
  assert.equal((await snapshot()).player.balances.healing_tonic,'0');
  await page.screenshot({path:folder+'/crafted-sale.png',fullPage:true});
  await page.waitForTimeout(2000);
  const bounds=await page.locator('#game canvas').boundingBox(),portal=spots.find(spot=>spot.kind==='arena');
  assert.ok(bounds&&portal);
  await page.locator('#game canvas').click({position:{x:portal.at[0]*bounds.width/WORLD.width,y:portal.at[1]*bounds.height/WORLD.height}});
  await expect(page.getByRole('region',{name:'Arena courtyard map'})).toBeVisible({timeout:30_000});
  await page.getByRole('region',{name:'Arena courtyard map'}).screenshot({path:folder+'/arena.png'});
  await page.waitForTimeout(2000);
  assert.deepEqual(errors,[]);
  record={source:'isolated local Sandbox; browser-held disposable keys',real_google_login:false,live_inference:false,initial_copper:'40',after_crafting_and_sale:'52',sold_tonics:1,arena_opened:true,page_errors:errors.length,video:'walkthrough.webm'};
}finally{
  await context.close();
  try{await video.saveAs(folder+'/walkthrough.webm');}finally{await browser.close();}
}
writeFileSync(folder+'/record.json',JSON.stringify(record,null,2)+'\n');
console.log('Verified craft → shelf → sale → arena; media saved in '+folder);
