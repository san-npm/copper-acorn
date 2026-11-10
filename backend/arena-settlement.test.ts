import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {arenaStep,type Store} from './arena-engine.ts';
import {makeDuel,type Profile} from './combat.ts';
import {duelRecord,settlePending,type ResultRecord,type Referee} from './arena-settlement.ts';

function fixture(){
  const a:Profile={id:randomUUID(),nickname:'Ada',character:'goblin',xp:0,wins:0,losses:0},b:Profile={id:randomUUID(),nickname:'Bryn',character:'lizard',xp:0,wins:0,losses:0};
  const d=makeDuel(randomUUID(),[a,b],100_000);d.result={winner:a.id,reason:'knockout'};
  const state:Store={version:1,profiles:{[a.id]:a,[b.id]:b},matches:{[d.id]:d},invites:[],requests:{},wallets:{[a.id]:'alice.testnet',[b.id]:'bob.testnet'}};
  state.settlements={[d.id]:{status:'pending',result:duelRecord(state,d)}};
  return {a,b,d,state};
}
test('a chain outage preserves pending XP, allows training and blocks only another ranked duel',async()=>{
  const {a,b,state}=fixture(),failing:Referee={result:async()=>{throw Error('offline');},settle:async()=>{throw Error('offline');},progress:async()=>{throw Error('offline');}};
  await assert.rejects(settlePending(state,failing),/offline/);assert.equal(state.profiles[a.id].xp,0);
  const practice=arenaStep(state,a.id,undefined,'POST',{kind:'practice',request_id:randomUUID()},100_001);assert.equal(practice.view.match?.training,true);assert.equal(Object.keys(practice.state.settlements!).length,1);
  assert.throws(()=>arenaStep(state,a.id,undefined,'POST',{kind:'challenge',target:b.id,request_id:randomUUID()},100_001),/NEAR confirmation/);
  const training=makeDuel(randomUUID(),[a,b],100_000);training.training=true;training.result={winner:a.id,reason:'knockout'};assert.throws(()=>duelRecord(state,training),/PvP/);
});
test('a lost chain acknowledgement reconciles the same result and cannot duplicate XP or overwrite a conflicting winner',async()=>{
  const {a,b,d,state}=fixture();let record:ResultRecord|null=null,reports=0;
  const referee:Referee={result:async()=>record,settle:async r=>{reports++;record=r;throw Error('ack lost');},progress:async account=>account==='alice.testnet'?{xp:20,wins:1,losses:0}:{xp:0,wins:0,losses:1}};
  await assert.rejects(settlePending(state,referee),/ack lost/);assert.equal(state.settlements![d.id].status,'pending');
  const confirmed=await settlePending(state,referee);assert.equal(confirmed.profiles[a.id].xp,20);assert.equal(confirmed.profiles[b.id].xp,0);assert.equal(confirmed.settlements![d.id].status,'confirmed');assert.equal(reports,1);
  assert.deepEqual(await settlePending(confirmed,referee),confirmed);assert.equal(reports,1);
  record={...state.settlements![d.id].result,winner:'bob.testnet'};await assert.rejects(settlePending(state,referee),/conflicts/);
});
