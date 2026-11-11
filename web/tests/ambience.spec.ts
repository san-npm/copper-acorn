import {test,expect} from './legacy';
import {writeFile} from 'node:fs/promises';

test('the actual hearth, lantern glass and cauldron steam visibly animate without economic requests',async({page})=>{
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.addInitScript(()=>localStorage.setItem('copper-acorn.sandbox-character','goblin'));
  let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
  await page.goto('/');
  const canvas=page.locator('#game canvas');await expect(canvas).toHaveAttribute('data-ambient-frame',/\d+/);
  const metrics=await canvas.evaluate(element=>new Promise<{name:string;mean:number;changed:number}[]>(resolve=>{
    const c=(element as HTMLCanvasElement).getContext('2d')!,regions=[{name:'hearth',x:294,y:106,w:34,h:40},{name:'cauldron-fire',x:359,y:202,w:46,h:14},{name:'workshop-lamp',x:883,y:153,w:26,h:34},{name:'spring-lamp',x:1039,y:325,w:26,h:34},{name:'herbalist-lamp',x:500,y:591,w:26,h:34},{name:'supplier-lamp',x:1305,y:539,w:26,h:34},{name:'steam',x:363,y:112,w:45,h:42}];
    const low=regions.map(r=>c.getImageData(r.x,r.y,r.w,r.h).data),high=low.map(p=>p.slice()),best=regions.map(r=>({name:r.name,mean:0,changed:0})),start=performance.now();
    // Measure the sampled range, so a middle-brightness first frame cannot hide the glow.
    const sample=()=>{regions.forEach((r,i)=>{const pixels=c.getImageData(r.x,r.y,r.w,r.h).data;let total=0,changed=0;for(let p=0;p<pixels.length;p+=4){for(let channel=0;channel<3;channel++){low[i][p+channel]=Math.min(low[i][p+channel],pixels[p+channel]);high[i][p+channel]=Math.max(high[i][p+channel],pixels[p+channel]);}const delta=(high[i][p]-low[i][p]+high[i][p+1]-low[i][p+1]+high[i][p+2]-low[i][p+2])/3;total+=delta;if(delta>=12)changed++;}best[i].mean=total/(r.w*r.h);best[i].changed=changed/(r.w*r.h);});if(performance.now()-start<5600)setTimeout(sample,100);else resolve(best);};sample();
  }));
  await writeFile('.local/visible-ambience-metrics.json',JSON.stringify(metrics,null,2));
  for(const result of metrics){expect(result.mean,result.name).toBeGreaterThan(2.5);expect(result.changed,result.name).toBeGreaterThan(.05);}
  await canvas.screenshot({path:'.local/visible-fire-steam-lights.png'});
  await page.getByRole('button',{name:'Choose character',exact:true}).click();
  const paused=await canvas.getAttribute('data-ambient-frame');
  await page.waitForTimeout(350);
  expect(await canvas.getAttribute('data-ambient-frame')).toBe(paused);
  await page.keyboard.press('Escape');
  await expect.poll(()=>canvas.getAttribute('data-ambient-frame')).not.toBe(paused);
  await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(250);
  const still=await canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL());
  await page.waitForTimeout(350);
  expect(await canvas.evaluate(el=>(el as HTMLCanvasElement).toDataURL())).toBe(still);
  expect(writes).toBe(0);
});
