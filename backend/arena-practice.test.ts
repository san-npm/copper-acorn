import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {arenaStep,type Store} from './arena-engine.ts';
import {settlePending,type Referee,type ResultRecord} from './arena-settlement.ts';
import type {Duel,Profile} from './combat.ts';

function fixture(){
  const a:Profile={id:randomUUID(),nickname:'Ada',character:'goblin',xp:0,wins:0,losses:0};
  const b:Profile={id:randomUUID(),nickname:'Bryn',character:'lizard',xp:0,wins:0,losses:0};
  let state:Store={version:1,profiles:{[a.id]:a,[b.id]:b},matches:{},invites:[],requests:{},wallets:{[a.id]:'alice.testnet',[b.id]:'bob.testnet'}};
  const step=(id:string,body?:Record<string,unknown>)=>{
    const result=arenaStep(state,id,undefined,body?'POST':'GET',body||null,100_000);
    assert.equal(result.conflict,undefined);state=result.state;return result.view;
  };
  const knockout=(duel:Duel)=>{
    const actor=duel.players[duel.active],target=duel.players[1-duel.active];
    actor.pos={x:1,y:2};target.pos={x:2,y:2};target.hp=1;
    return step(actor.id,{kind:'act',match:duel.id,version:duel.version,action:{kind:'cast',skill:actor.character==='goblin'?'shiv':'scale',target:target.id},request_id:randomUUID()});
  };
  const train=(id:string)=>knockout(step(id,{kind:'practice',request_id:randomUUID()}).match!);
  const fight=()=>{
    const invite=step(a.id,{kind:'challenge',target:b.id,request_id:randomUUID()}).invitations[0];
    const accept={kind:'accept',invite:invite.id,request_id:randomUUID()};
    const match=step(b.id,accept).match!;const finished=knockout(match).match!;
    return {accept,match:finished};
  };
  return {a,b,step,train,fight,state:()=>state,reload:()=>{state=JSON.parse(JSON.stringify(state));},settle:async(referee:Referee)=>{state=await settlePending(state,referee);}};
}

test('completed training cannot hide a later PvP result or its settlement after reload',async()=>{
  const f=fixture(),training=[f.train(f.a.id).match!,f.train(f.b.id).match!];
  assert.ok(training.every(d=>d.training&&d.result));
  const {match}=f.fight();assert.ok(match.result?.winner);assert.equal(match.training,undefined);
  f.reload();
  for(const player of [f.a,f.b]){
    const view=f.step(player.id);
    assert.equal(view.match?.id,match.id);assert.equal(view.match?.result?.winner,match.result!.winner);
    assert.equal(view.settlement?.status,'pending');assert.equal(view.settlement?.result.match_id,match.id);
    assert.equal(view.profile.xp,0);
  }
  let record:ResultRecord|null=null,submissions=0;
  const winner=f.state().wallets![match.result!.winner!];
  await f.settle({
    result:async()=>record,
    settle:async result=>{record=structuredClone(result);submissions++;return {hash:'confirmed-duel'};},
    progress:async account=>account===winner?{xp:20,wins:1,losses:0}:{xp:0,wins:0,losses:1},
  });
  f.reload();
  for(const player of [f.a,f.b]){
    const view=f.step(player.id);
    assert.equal(view.match?.id,match.id);assert.equal(view.settlement?.status,'confirmed');
    assert.equal(view.profile.xp,player.id===match.result!.winner?20:0);
  }
  assert.equal(submissions,1);
});

test('replaying a prior PvP acceptance cannot erase newer training for either participant',()=>{
  const f=fixture();f.train(f.a.id);f.train(f.b.id);
  const {accept}=f.fight();
  const sessions=[f.step(f.a.id,{kind:'practice',request_id:randomUUID()}).match!,f.step(f.b.id,{kind:'practice',request_id:randomUUID()}).match!];
  const replay=f.step(f.b.id,accept);
  assert.equal(replay.match?.id,sessions[1].id);assert.equal(replay.match?.training,true);
  f.reload();
  assert.equal(f.step(f.a.id).match?.id,sessions[0].id);
  assert.equal(f.step(f.b.id).match?.id,sessions[1].id);
});
