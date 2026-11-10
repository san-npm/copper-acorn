import {test,expect} from '@playwright/test';
import {classes,makeDuel,type CharacterId} from '../../backend/combat.ts';

test('every class skill plays a decoded pose and impact; reduced motion keeps static outcomes',async({page})=>{
  test.skip(process.env.VITE_PUBLIC_LOCAL_ART!=='true','Private pose-sheet verification');
  test.setTimeout(90_000);
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/effects-harness',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><link rel="stylesheet" href="/src/arena.css"><div class="arena-world arena-board" style="width:800px"><div data-unit="caster" class="arena-unit" style="left:50%;top:50%"><span class="arena-actor"></span></div></div>'}));
  await page.goto('/effects-harness');
  for(const [character,kit] of Object.entries(classes))for(const skill of kit.skills){
    const profile={id:'caster',nickname:'Caster',character:character as CharacterId,xp:0,wins:0,losses:0};
    const d=makeDuel('visual-test',[profile,{...profile,id:'target'}],0,0);
    const event={version:1,actor:'caster',skill:skill.id,from:d.players[0].pos,to:skill.target==='self'?d.players[0].pos:d.players[1].pos,changes:[{id:'caster',pos:d.players[0].pos,hp:skill.target==='self'?12:-16,shield:0}]};
    await page.evaluate(async({d,event})=>{
      const actor=document.querySelector<HTMLElement>('.arena-actor')!;actor.style.backgroundImage=`url('/assets/characters/${d.players[0].character}.png')`;
      const module='/src/combat-effects.ts',fx=await import(module);
      (window as any).playback=fx.playCombatEffect(document.querySelector('.arena-board'),d,event,false);
    },{d,event});
    const pose=page.locator('.arena-actor.casting');await expect(pose,skill.name).toBeVisible();
    const first=await pose.evaluate(el=>getComputedStyle(el).backgroundPositionX);await page.waitForTimeout(180);
    const next=await pose.evaluate(el=>getComputedStyle(el).backgroundPositionX);expect(next,skill.name+' changes pose frames').not.toBe(first);
    await expect(page.locator('.spell-impact')).toBeVisible();
    await expect(page.locator('.combat-number')).toHaveText(skill.target==='self'?'+12':'−16');
    await page.evaluate(()=>(window as any).playback);await expect(page.locator('.combat-effects')).toHaveCount(0);
  }
  await page.evaluate(async()=>{
    const module='/src/combat-effects.ts',fx=await import(module),d={players:[{id:'caster',character:'magician'}]};
    (window as any).playback=fx.playCombatEffect(document.querySelector('.arena-board'),d,{version:2,actor:'caster',skill:'mend',from:{x:1,y:3},to:{x:1,y:3},changes:[{id:'caster',pos:{x:1,y:3},hp:12,shield:0}]},true);
  });
  await expect(page.locator('.combat-number.healing')).toHaveText('+12');await expect(page.locator('.arena-actor.casting')).toHaveCount(0);
  expect(await page.locator('.arena-board').evaluate(el=>el.getAnimations({subtree:true}).length)).toBe(0);
  await page.evaluate(()=>(window as any).playback);await expect(page.locator('.combat-effects')).toHaveCount(0);expect(errors).toEqual([]);
});
