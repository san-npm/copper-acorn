import assert from 'node:assert/strict';
import test from 'node:test';
import { decide, marketProgress, needFor, type Need } from '../supabase/functions/game-api/market.ts';
import cases from './fixtures/merchant-policy-cases.json' with {type:'json'};
import canonical from './fixtures/merchant-evidence.json' with {type:'json'};
import bundled from '../supabase/functions/game-api/merchant-evidence.json' with {type:'json'};

test('hosted and Sandbox planners pass the same thirteen money/inventory policy cases',()=>{
  assert.deepEqual(bundled,canonical);
  for (const entry of cases.cases) {
    const state=structuredClone(cases.base) as any;
    for (const patch of entry.patches) {
      const path=patch.path.slice(1).split('/');let target=state;
      for (const key of path.slice(0,-1)) target=target[key];
      target[path.at(-1)!]=patch.value;
    }
    const need={...needFor('mira',0),...('probabilities' in entry ? {probabilities:entry.probabilities}: {})} as Need;
    const result=decide(state,need);
    assert.deepEqual({method:result.method,args:result.args,probability:result.probability},entry.expected,entry.name);
  }
});

test('confirmed journal restores turn/day state and rejects gaps, excess turns or unsupported methods',()=>{
  const records:any[]=[];
  for (let tick=0;tick<10;tick++) records.push({action:{kind:'market_tick',tick},result:{method:tick===0?'trade':'world_view'}});
  let status=marketProgress(records,3);
  assert.equal(status.tick,10);assert.equal(status.day_ticks,10);assert.equal(status.events[0].day,3);
  assert.equal(status.events[0].decision.merchant,'mira');assert.equal(status.events[1].decision.method,null);
  records.push({action:{kind:'next_day'},result:{}});
  status=marketProgress(records,4);assert.equal(status.day_ticks,0);assert.equal(status.tick,10);
  assert.equal(status.events[0].day,3);
  assert.throws(()=>marketProgress([{action:{kind:'market_tick',tick:1},result:{method:'trade'}}],0));
  assert.throws(()=>marketProgress([...records.slice(0,10),{action:{kind:'market_tick',tick:10},result:{method:'trade'}}],0));
  assert.throws(()=>marketProgress([{action:{kind:'market_tick',tick:0},result:{method:'delete_account'}}],0));
  assert.throws(()=>needFor('mira',-1));assert.throws(()=>needFor('unknown',0));
});
