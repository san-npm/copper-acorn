import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gatheringProblem} from '../web/src/gathering.ts';
import type {Item} from '../web/src/types.ts';

const silver:Item={token_id:'silver_dust',name:'Silver Dust',kind:'ingredient',base_value:'12',gather_cap:'1',gathered_today:'0',recipe:null};
test('unmined silver is available; persisted mining stays spent until the market day advances',()=>{
  assert.equal(gatheringProblem(silver,1,0),null);
  const spent={...silver,gathered_today:'1'};
  assert.match(gatheringProblem(spent,1,0)!,/collected 1\/1 Silver Dust on market day 1/);
  assert.match(gatheringProblem(structuredClone(spent),1,0)!,/Reopening the game does not start a new market day/);
  assert.equal(gatheringProblem(silver,1,1),null);
});
test('too large a batch and an unavailable ingredient do not claim an exhausted patch',()=>{
  assert.match(gatheringProblem(silver,2,0)!,/Only 1 Silver Dust left/);
  assert.match(gatheringProblem({...silver,gather_cap:'0'},1,0)!,/cannot be gathered/);
  assert.match(gatheringProblem(undefined,1,0)!,/Refresh your ledger/);
});
