import test from 'node:test';
import assert from 'node:assert/strict';
import {ARENA,arenaNavigation,arenaSpawn,combatCells,combatPoint} from '../web/src/arena-layout.ts';

test('the arena floor joins every arrival point, chicken and return-portal approach',()=>{
  const targets=[ARENA.chicken,ARENA.exitApproach,[900,520]] as [number,number][];
  for(let i=0;i<20;i++)for(const target of targets){
    const spawn=arenaSpawn('player-'+i),route=arenaNavigation.path(spawn,target);assert.ok(route);
    let from=spawn;for(const to of route){assert.ok(arenaNavigation.clear(from,to));from=to;}
  }
});
test('stands, parapets, flower borders and the return portal base cannot be walked through',()=>{
  for(const point of [[500,100],[100,200],[20,850],[800,900],ARENA.exit] as [number,number][])assert.equal(arenaNavigation.walkable(point),false);
});

test('combat follows the whole courtyard floor and leaves no placeholder walls or disconnected tiles',()=>{
  assert.ok(combatCells.length>49);
  for(const point of [{x:0,y:7},{x:6,y:-1},{x:0,y:1},{x:6,y:6},{x:7,y:2},{x:3,y:3},{x:2,y:1},{x:4,y:5}])assert.ok(combatCells.some(c=>c.x===point.x&&c.y===point.y));
  for(const point of [{x:0,y:0},{x:2,y:6}])assert.equal(combatCells.some(c=>c.x===point.x&&c.y===point.y),false);
  const reached=[combatCells[0]],keys=new Set([JSON.stringify(combatCells[0])]);
  for(let i=0;i<reached.length;i++)for(const next of combatCells){
    if(Math.abs(reached[i].x-next.x)+Math.abs(reached[i].y-next.y)!==1||keys.has(JSON.stringify(next)))continue;
    assert.ok(arenaNavigation.clear(combatPoint(reached[i].x,reached[i].y),combatPoint(next.x,next.y)));
    keys.add(JSON.stringify(next));reached.push(next);
  }
  assert.equal(reached.length,combatCells.length);
});
