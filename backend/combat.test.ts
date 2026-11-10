import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {classes,makeDuel,perform,expire,power,totalXp,xpForWin,levelForXp,sight,path,type CharacterId,type Duel,type CombatAction} from './combat.ts';

function duel(a:CharacterId='goblin',b:CharacterId='elf',level=1){
  return makeDuel('match',[{id:'a',nickname:'Ada',character:a,xp:totalXp(level),wins:0,losses:0},{id:'b',nickname:'Bram',character:b,xp:totalXp(level),wins:0,losses:0}],0);
}
function cast(d:Duel,skill:string,target='b',cell?:{x:number;y:number}){perform(d,d.players[d.active].id,{kind:'cast',skill,...(cell||{target})},1);}
function next(d:Duel){perform(d,d.players[d.active].id,{kind:'end'},1);}
function close(d:Duel){d.players[0].pos={x:1,y:2};d.players[1].pos={x:2,y:2};}
function unchanged(d:Duel,actor:string,action:CombatAction,message?:RegExp){const before=structuredClone(d);assert.throws(()=>perform(d,actor,action,1),message);assert.deepEqual(d,before);}

test('all eight classes have exactly three unique skills; level and XP growth have exact endpoints',()=>{
  assert.equal(Object.keys(classes).length,8);assert.equal(new Set(Object.values(classes).flatMap(c=>c.skills.map(s=>s.id))).size,24);
  assert.equal(power(12,20),23);assert.equal(power(17,20),33);assert.equal(totalXp(20),10_485_740);
  assert.equal(levelForXp(10_485_740),20);assert.equal(levelForXp(Number.MAX_SAFE_INTEGER),20);assert.equal(xpForWin(20,20),0);
  assert.equal(xpForWin(1,20),62);assert.equal(xpForWin(1,1),20);
  assert.equal(duel('vampire','dwarf',20).players[0].maxHp,195);
});
test('the painted skill atlas covers all24 skills with equal square tiles',()=>{
  const atlas=JSON.parse(readFileSync(new URL('../web/public/assets/ui/skills.json',import.meta.url),'utf8'));
  const png=readFileSync(new URL('../web/public/assets/ui/skills.png',import.meta.url));
  assert.deepEqual(atlas.skills,Object.values(classes).flatMap(c=>c.skills.map(s=>s.id)));assert.equal(new Set(atlas.skills).size,24);
  assert.equal(atlas.columns*atlas.rows,24);assert.equal(png.readUInt32BE(16),atlas.width);assert.equal(png.readUInt32BE(20),atlas.height);assert.equal(atlas.width/atlas.columns,atlas.height/atlas.rows);
});

test('movement obeys walls, occupation, remaining points and four-cell melee adjacency',()=>{
  const d=duel();unchanged(d,'b',{kind:'move',x:4,y:3},/turn/);
  unchanged(d,'a',{kind:'move',x:0,y:0},/reachable/);unchanged(d,'a',{kind:'move',x:5,y:3},/reachable/);
  assert.equal(sight({x:1,y:3},{x:5,y:3}),true);
  perform(d,'a',{kind:'move',x:1,y:2},1);assert.equal(d.players[0].mp,2);assert.equal(d.players[0].moved,true);
  d.players[1].pos={x:2,y:3};unchanged(d,'a',{kind:'cast',skill:'shiv',target:'b'},/range/);
  d.players[1].pos={x:2,y:2};cast(d,'shiv');assert.equal(d.players[1].hp,84);
  assert.deepEqual(path(d,d.players[0].pos,d.players[0].pos,'a'),[]);
  const outer=duel();outer.players[0].pos={x:6,y:2};perform(outer,'a',{kind:'move',x:7,y:2},1);assert.deepEqual(outer.players[0].pos,{x:7,y:2});assert.equal(outer.players[0].mp,2);
});
test('exact sixty-second expiry passes once and gives the other player a full minute',()=>{
  const d=duel();assert.equal(d.deadline,60_000);assert.equal(expire(d,59_999),false);
  const before=structuredClone(d);assert.throws(()=>perform(d,'a',{kind:'move',x:1,y:2},60_000),/expired/);assert.deepEqual(d,before);
  assert.equal(expire(d,60_000),true);assert.equal(d.active,1);assert.equal(d.deadline,120_000);assert.equal(d.version,1);
  assert.equal(expire(d,60_000),false);assert.equal(d.version,1);
});
test('poison refreshes instead of stacking and ticks exactly at two victim turn starts',()=>{
  const d=duel();close(d);cast(d,'shiv');cast(d,'shiv');assert.equal(d.players[1].hp,68);
  next(d);assert.equal(d.players[1].hp,64);next(d);next(d);assert.equal(d.players[1].hp,60);
  next(d);next(d);assert.equal(d.players[1].hp,60);assert.equal(d.players[1].effects.poison,undefined);
});
test('healing uses actual damage, is capped, cleanses a dot, and respects cooldowns',()=>{
  const d=duel('vampire');close(d);d.players[0].hp=50;d.players[1].hp=5;
  cast(d,'thread');assert.equal(d.players[0].hp,52);assert.equal(d.result?.winner,'a');
  const other=duel('vampire');other.players[0].hp=80;other.players[0].effects.poison={amount:4,ticks:2,source:'b',order:0};
  cast(other,'mend');assert.equal(other.players[0].hp,100);assert.equal(other.players[0].effects.poison,undefined);
  next(other);next(other);unchanged(other,'a',{kind:'cast',skill:'mend'},/cooling/);
  next(other);next(other);cast(other,'mend');assert.equal(other.players[0].hp,100);
});
test('shields expire, require a health hit and never heal the protector',()=>{
  const d=duel('lizard');close(d);d.players[0].hp=70;
  cast(d,'scale');cast(d,'scale');assert.equal(d.players[0].hp,70);assert.equal(d.players[0].shields[0].amount,12);
  next(d);next(d);assert.equal(d.players[0].shields.length,0);cast(d,'guard');assert.equal(d.players[0].shields[0].amount,28);
  next(d);next(d);assert.equal(d.players[0].shields[0].amount,28);next(d);next(d);assert.equal(d.players[0].shields.length,0);
});
test('berserker health costs are nonlethal, conditional damage scales once, and charge ends adjacent',()=>{
  const d=duel('dark-elf');d.players[0].hp=8;unchanged(d,'a',{kind:'cast',skill:'price'},/last health/);
  d.players[0].hp=24;close(d);cast(d,'cleave');assert.equal(d.players[1].hp,70);
  const charge=duel('dark-elf');charge.players[0].pos={x:1,y:2};charge.players[1].pos={x:4,y:2};
  cast(charge,'price');cast(charge,'rupture');assert.equal(charge.players[0].hp,92);assert.equal(charge.players[1].hp,55);assert.equal(charge.players[0].pos.x,3);
});
test('archer range, before-moving bonus, straight displacement and AP denial are enforced',()=>{
  const d=duel('elf');d.players[1].pos={x:1,y:6};cast(d,'briar');assert.equal(d.players[1].hp,79);
  perform(d,'a',{kind:'move',x:1,y:2},1);cast(d,'briar');assert.equal(d.players[1].hp,61);
  const denied=duel('elf');denied.players[1].pos={x:1,y:6};cast(denied,'silence');next(denied);assert.equal(denied.players[1].ap,4);next(denied);next(denied);assert.equal(denied.players[1].ap,6);
});
test('pyromancer detonation consumes the burn and the revised setup has a distinct burst payoff',()=>{
  const d=duel('magician');d.players[1].pos={x:1,y:6};cast(d,'lance');assert.equal(d.players[1].hp,84);
  next(d);assert.equal(d.players[1].hp,79);next(d);cast(d,'flash');assert.equal(d.players[1].hp,33);assert.equal(d.players[1].effects.burn,undefined);
});
test('summons wait until a later turn, can be sacrificed, and never become inventory items',()=>{
  const d=duel('skeleton');close(d);d.players[1].pos={x:4,y:2};
  cast(d,'raise','',{x:2,y:2});next(d);assert.equal(d.players[1].hp,100);next(d);next(d);assert.equal(d.players[1].hp,94);assert.equal(d.visuals?.at(-1)?.actor,'a-bone');assert.equal(d.visuals?.at(-1)?.changes[0].hp,-6);
  next(d);d.players[0].hp=50;d.minions[0].hp=7;cast(d,'recall',d.minions[0].id);assert.equal(d.players[0].hp,57);assert.equal(d.minions.length,0);
});
test('summoning onto an enemy trap triggers it immediately without treating minion death as victory',()=>{
  const d=duel('dwarf','skeleton');d.players[1].pos={x:2,y:2};cast(d,'snare','',{x:2,y:3});next(d);
  cast(d,'raise','',{x:2,y:3});assert.equal(d.traps.length,0);assert.equal(d.minions.length,0);assert.equal(d.result,null);assert.equal(d.players[1].ap,3);
});
test('hunter marks, lays one trap and pulls an enemy into it with one MP penalty',()=>{
  const d=duel('dwarf');d.players[0].pos={x:1,y:2};d.players[1].pos={x:4,y:2};
  cast(d,'quarry');cast(d,'snare','',{x:3,y:2});next(d);next(d);cast(d,'harpoon');
  assert.equal(d.players[1].hp,55);assert.equal(d.traps.length,0);next(d);assert.equal(d.players[1].mp,1);
});
test('smoke evades one hit, weakness and healing reduction expire after the victim turn',()=>{
  const d=duel('goblin','vampire');close(d);cast(d,'smoke','',{x:1,y:1});next(d);
  d.players[0].pos={x:1,y:2};cast(d,'thread','a');assert.equal(d.players[0].hp,93);cast(d,'thread','a');assert.equal(d.players[0].hp,78);
  const oath=duel('vampire','elf');oath.players[1].pos={x:1,y:6};cast(oath,'oath');next(oath);cast(oath,'briar','a');assert.equal(oath.players[0].hp,86);next(oath);next(oath);assert.equal(oath.players[1].effects.weak,undefined);
  const needle=duel('skeleton','vampire');needle.players[1].pos={x:1,y:6};needle.players[1].hp=50;cast(needle,'needle');next(needle);cast(needle,'mend','b');assert.equal(needle.players[1].hp,51);assert.equal(needle.players[1].effects.healing!==undefined,true);next(needle);assert.equal(needle.players[1].effects.healing,undefined);
});
test('fire zones tick once per round, last two enemy turns, and cannot be placed in walls',()=>{
  const d=duel('magician');d.players[0].pos={x:1,y:2};d.players[1].pos={x:1,y:5};
  unchanged(d,'a',{kind:'cast',skill:'ash',x:0,y:0},/visible/);
  cast(d,'ash','',{x:1,y:4});next(d);assert.equal(d.players[1].hp,92);
  perform(d,'b',{kind:'move',x:2,y:4},1);assert.equal(d.players[1].hp,92);
  next(d);next(d);assert.equal(d.players[1].hp,84);next(d);assert.equal(d.zones.length,0);
});
test('poison combo, grounding, trap duration and death during movement preserve turn rules',()=>{
  const g=duel('goblin');close(g);cast(g,'shiv');next(g);next(g);cast(g,'cheap');assert.equal(g.players[1].hp,46);
  const anchor=duel('lizard','elf');anchor.players[1].pos={x:1,y:5};cast(anchor,'anchor');next(anchor);assert.equal(anchor.players[1].mp,1);cast(anchor,'gale','a');assert.deepEqual(anchor.players[0].pos,{x:1,y:3});
  const trap=duel('dwarf');cast(trap,'snare','',{x:1,y:4});for(let i=0;i<5;i++)next(trap);assert.equal(trap.traps.length,1);next(trap);assert.equal(trap.traps.length,0);
  const lethal=duel('dwarf');lethal.players[0].pos={x:0,y:3};lethal.players[1].pos={x:1,y:6};cast(lethal,'snare','',{x:1,y:4});next(lethal);lethal.players[1].hp=1;
  perform(lethal,'b',{kind:'move',x:1,y:3},1);assert.deepEqual(lethal.players[1].pos,{x:1,y:4});assert.equal(lethal.result?.winner,'a');
});
test('low-health ends stop actions; fatigue damages both fighters instead of choosing a health winner',()=>{
  const d=duel();for(let i=0;i<16;i++)next(d);assert.equal(d.result,null);assert.equal(d.round,9);
  while(!d.result)next(d);assert.equal(d.result.winner,null);assert.equal(d.players[0].hp,0);assert.equal(d.players[1].hp,0);
  assert.throws(()=>perform(d,'a',{kind:'end'},1),/ended/);
});
test('training skips the passive target, ticks effects and never damages either fighter through fatigue',()=>{
  const d=duel('magician','lizard');d.training=true;d.players[1].pos={x:1,y:6};cast(d,'lance');next(d);
  assert.equal(d.active,0);assert.equal(d.players[1].hp,79);assert.equal(d.players[0].hp,100);
  for(let i=0;i<40;i++)next(d);
  assert.equal(d.players[0].hp,100);assert.equal(d.players[1].hp,74);assert.equal(d.result,null);assert.ok(d.round>40);
});
