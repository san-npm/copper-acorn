import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium, expect } from '@playwright/test';

const base='http://127.0.0.1:5175';
const folder='.local/walkthrough'; mkdirSync(folder,{recursive:true,mode:0o700});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1600,height:1000},recordVideo:{dir:folder,size:{width:1600,height:1000}},reducedMotion:'no-preference'});
await context.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
const page=await context.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
async function action(trigger) {
  const sent=page.waitForResponse(r=>r.url().endsWith('/api/action') && r.request().method()==='POST');
  await trigger(); const op=await(await sent).json(); assert.equal(op.status,'confirmed');
  await expect(page.locator('#action-status')).toContainText('Confirmed.');
}
try {
  await page.goto(base); await expect(page.locator('#copper')).toHaveText('40');
  await page.waitForTimeout(1000);
  await page.locator('#gather-spring_water').click();
  await action(()=>page.getByRole('button',{name:'Collect Spring Water',exact:true}).click());
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await action(()=>page.getByRole('button',{name:'Brew Healing Tonic',exact:true}).click());
  await page.getByRole('button',{name:'Shelves',exact:true}).click();
  await page.getByLabel('Price in Copper').fill('13');
  await action(()=>page.getByRole('button',{name:'Put on shelf',exact:true}).click());
  await action(()=>page.getByRole('button',{name:'Serve gardener · 13 Copper',exact:true}).click());
  await page.getByRole('button',{name:'Cauldron',exact:true}).click();
  await action(()=>page.getByRole('button',{name:'Brew Focus Draught',exact:true}).click());
  await page.getByRole('button',{name:'Orders',exact:true}).click();
  await action(()=>page.getByRole('button',{name:'Deliver Focus Draught',exact:true}).click());
  await expect(page.locator('#panel')).toContainText('1 / 2 delivered');
  await page.screenshot({path:`${folder}/quest-progress.png`,fullPage:true});
  const state=await(await context.request.get(`${base}/api/state`)).json();
  assert.equal(state.quests.delivered[1],1); assert.equal(state.player.balances.copper,'75');
  await page.waitForTimeout(1000);
  assert.deepEqual(errors,[]);
  writeFileSync(`${folder}/record.json`,JSON.stringify({source:'isolated headless local capture',transactions:6,quest_focus_delivered:1,ordinary_copper:'75',private_art:true,publication:false,video:await page.video().path()},null,2));
} finally {await context.close();await browser.close();}
