// Isolated local artwork checks; no login, wallet or owner-browser interaction.
import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';

const root=new URL('../',import.meta.url),output=new URL('.local/mana-review/',root);
const manifest=JSON.parse(readFileSync(new URL('assets/actions/manifest.json',output)));
const hash=text=>createHash('sha256').update(text).digest('hex');
for(const [name,digest] of Object.entries(manifest.sha256))assert.equal(hash(readFileSync(new URL(`assets/actions/${name}`,output))),digest);
assert.deepEqual(manifest.sparkles.durations,[200,200,200]);
assert.equal(manifest.waterfall.durations.length,6);
mkdirSync(new URL('action-checks/',output),{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100},reducedMotion:'reduce'});
  const errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push([r.method(),r.url()]));
  await page.goto('http://127.0.0.1:8765/actions.html');
  await expect(page.locator('#play')).toBeEnabled();
  await expect(page.locator('#play')).toHaveText('Play');
  await page.locator('#character').selectOption('goblin');
  await page.getByRole('button',{name:'Collect water',exact:true}).click();
  for(const [row,sign] of [[1,-1],[2,1]]){
    await page.locator('#facing').selectOption(String(row));
    await expect(page.locator('#play')).toBeEnabled();
    const eye=await page.locator('#stage').evaluate(canvas=>{
      const {data}=canvas.getContext('2d').getImageData(330,210,108,60);const xs=[];
      for(let y=0;y<60;y++)for(let x=0;x<108;x++){
        const i=(y*108+x)*4;if(data[i]===248&&data[i+1]===240&&data[i+2]===224)xs.push(330+x);
      }
      return {count:xs.length,x:xs.reduce((a,b)=>a+b,0)/xs.length};
    });
    assert(eye.count>0,'Goblin eye is not visible');
    assert((eye.x-384)*sign>0,'Goblin faces away from the selected side');
    const pond=manifest.actions.find(a=>a.id==='water').resourcePoints[row];
    assert((eye.x-384)*(pond[0]-32)>0,'Goblin faces away from the water');
    await page.locator('#stage').screenshot({path:new URL(`action-checks/goblin-water-${row}.png`,output).pathname});
    await page.getByRole('button',{name:'Replay',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('stage').dataset.frame==='3');
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    const handX=row===1?330:432;
    const cork=await page.locator('#stage').evaluate((canvas,x)=>[...canvas.getContext('2d').getImageData(x,264,1,1).data].slice(0,3),handX);
    assert.deepEqual(cork,[214,186,128],'Bottle is detached from the hand during Fill');
    await page.locator('#stage').screenshot({path:new URL(`action-checks/goblin-water-fill-${row}.png`,output).pathname});
  }
  let selections=0;
  for(const character of manifest.characters){
    await page.locator('#character').selectOption(character.id);
    for(const action of manifest.actions){
      await page.getByRole('button',{name:action.name,exact:true}).click();
      for(let row=0;row<4;row++){
        await page.locator('#facing').selectOption(String(row));
        await expect(page.locator('#play')).toBeEnabled();
        await expect(page.locator('#description')).toHaveText(`${character.name} · ${action.name}`);
        await expect(page.locator('#stage')).toHaveAttribute('data-frame','0');
        assert.equal(await page.locator('#stage').getAttribute('aria-label'),`${character.name}, ${action.name.toLowerCase()}, ${['front','left','right','back'][row]} view`);
        selections++;
      }
    }
  }
  await page.locator('#character').selectOption('magician');
  await page.locator('#facing').selectOption('0');
  for(const action of manifest.actions){
    await page.getByRole('button',{name:action.name,exact:true}).click();
    await expect(page.locator('#play')).toBeEnabled();
    await page.getByRole('button',{name:'Replay',exact:true}).click();
    await page.waitForFunction(()=>document.getElementById('stage').dataset.frame==='4');
    await page.getByRole('button',{name:'Pause',exact:true}).click();
    const frozen=await page.locator('#stage').evaluate(c=>c.toDataURL());
    await page.waitForTimeout(240);
    assert.equal(await page.locator('#stage').evaluate(c=>c.toDataURL()),frozen,'Paused canvas changed');
    await page.locator('#stage').screenshot({path:new URL(`action-checks/${action.id}.png`,output).pathname});
    await page.getByRole('button',{name:'Play',exact:true}).click();
    await expect(page.locator('#status')).toHaveText('Action complete. Replay to watch again.');
    await expect(page.locator('#stage')).toHaveAttribute('data-frame','7');
  }
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.getByRole('button',{name:'Mine silver',exact:true}).click();
  await page.locator('#loop').check();
  await page.getByRole('button',{name:'Replay',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('stage').dataset.frame==='6');
  await page.waitForFunction(()=>document.getElementById('stage').dataset.frame==='1');
  await page.emulateMedia({reducedMotion:'reduce'});
  await expect(page.locator('#play')).toHaveText('Play');
  const frozen=await page.locator('#stage').evaluate(c=>c.toDataURL());
  await page.waitForTimeout(240);
  assert.equal(await page.locator('#stage').evaluate(c=>c.toDataURL()),frozen);
  await page.screenshot({path:new URL('actions-browser-preview.png',output).pathname,fullPage:true});
  await page.setViewportSize({width:320,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.getByRole('button',{name:'Collect water',exact:true}).click();
  await expect(page.locator('#play')).toBeEnabled();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.screenshot({path:new URL('actions-mobile-preview.png',output).pathname,fullPage:true});
  assert.deepEqual(errors,[]);
  assert(requests.every(([method,url])=>method==='GET'&&new URL(url).origin==='http://127.0.0.1:8765'));
  console.log(JSON.stringify({selections,playedActions:5,pause:'stable',completion:'returns to idle',loop:'wraps',reducedMotion:'pauses',mobileWidth:320,externalOrWriteRequests:0,pageErrors:errors}));
}finally{await browser.close()}
