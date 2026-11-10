import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createArenaHandler} from '../supabase/functions/arena-api/handler.ts';
import type {Store} from './arena-engine.ts';
import {makeDuel} from './combat.ts';

const owners=[randomUUID(),randomUUID()],worlds=[randomUUID(),randomUUID()],sessions=[randomUUID(),randomUUID()];
const tokens=owners.map((sub,i)=>['header',Buffer.from(JSON.stringify({sub,session_id:sessions[i],exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),'verified'].join('.'));
const config={url:'https://example.supabase.co',publishableKey:'public-test-key',secretKey:'server-test-key',origins:['https://game.example']};
function fixture(){
  let state:Store={version:1,profiles:{},matches:{},invites:[],requests:{}},revision=0,contention=0,revoked=false,inactive=false,authFailure=false,lostCommit=false;
  let format:'modern'|'legacy'|'unselected'='modern',character:unknown='goblin';
  const calls:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const r=new Request(input,init),url=new URL(r.url),b=r.method==='POST'?await r.json():null;calls.push(url.pathname);
    if(url.pathname==='/auth/v1/user'){
      const i=tokens.indexOf(r.headers.get('authorization')!.slice(7));
      return i<0||authFailure?Response.json({message:'Invalid JWT',code:'bad_jwt'},{status:401}):Response.json({id:owners[i],is_anonymous:false,email_confirmed_at:'2026-11-09T00:00:00Z',user_metadata:{character_id:character,full_name:'Private account name'}});
    }
    if(url.pathname.endsWith('/game_session_active'))return Response.json(!revoked&&owners.indexOf(b.p_owner)>=0&&sessions[owners.indexOf(b.p_owner)]===b.p_session);
    if(url.pathname==='/rest/v1/game_worlds'){
      const i=owners.findIndex(id=>url.searchParams.get('user_id')==='eq.'+id);
      return Response.json(i<0||url.searchParams.get('id')!=='eq.'+worlds[i]?[]:[{id:worlds[i],status:'ready',contract_id:'shop-'+i+'.testnet',is_active:!inactive}]);
    }
    if(url.pathname==='/rest/v1/game_arena_state')return Response.json({revision,state:structuredClone(state)});
    if(url.pathname.endsWith('/commit_game_arena')){
      assert.equal(sessions[owners.indexOf(b.p_owner)],b.p_session);assert.equal(worlds[owners.indexOf(b.p_owner)],b.p_world);
      if(contention>0){contention--;revision++;return Response.json(false);}
      if(b.p_revision!==revision)return Response.json(false);
      state=structuredClone(b.p_state);revision++;if(lostCommit){lostCommit=false;return Response.json({message:'Simulated lost acknowledgement'},{status:503});}return Response.json(true);
    }
    if(url.hostname==='test.rpc.fastnear.com'){
      assert.equal(r.headers.get('Authorization'),null);assert.equal(b.method,'query');assert.ok(['alchemist_view','game_view'].includes(b.params.method_name));
      const i=b.params.account_id==='shop-0.testnet'?0:1;
      if(b.params.method_name==='alchemist_view'&&format==='legacy')return Response.json({result:{error:'MethodResolveError(MethodNotFound)'}});
      const alchemist={nickname:i?'Bram':'Ada',character_id:i?'elf':'goblin'};
      const result=b.params.method_name==='alchemist_view'?alchemist:format==='legacy'?{player:{account_id:'player-'+i+'.testnet'}}:{batch_limit:10,alchemist:format==='unselected'?null:alchemist};
      return Response.json({result:{result:[...Buffer.from(JSON.stringify(result))]}});
    }
    throw Error('Unexpected fixture request '+url.pathname);
  };
  const handler=createArenaHandler(config,fetcher);
  const request=(i:number,body?:object,id=worlds[i],origin=config.origins[0],bearer=tokens[i])=>new Request(config.url+'/functions/v1/arena-api?world_id='+id,{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+bearer,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const call=async(i:number,body?:object)=>{const r=await handler(request(i,body));return{status:r.status,data:await r.json()};};
  return{handler,request,call,calls,state:()=>state,format:(v:typeof format)=>format=v,character:(v:unknown)=>character=v,contend:(n:number)=>contention=n,revoke:()=>revoked=true,inactive:()=>inactive=true,invalidAuth:()=>authFailure=true,loseCommit:()=>lostCommit=true,restart:()=>createArenaHandler(config,fetcher)};
}

test('an older owned shop enters using its verified saved appearance without changing the contract or exposing account names',async()=>{
  const f=fixture();f.format('legacy');
  const joined=await f.call(0);assert.equal(joined.status,200);assert.equal(joined.data.profile.character,'goblin');assert.equal(joined.data.profile.nickname,'Goblin');
  assert.ok(!JSON.stringify(joined.data).includes('Private account name'));
  f.character('elf');assert.equal((await f.call(0)).data.profile.character,'goblin');
  const unselected=fixture();unselected.format('unselected');assert.equal((await unselected.call(0)).status,409);assert.equal(Object.keys(unselected.state().profiles).length,0);
  const invalid=fixture();invalid.format('legacy');invalid.character('administrator');assert.equal((await invalid.call(0)).status,409);assert.equal(Object.keys(invalid.state().profiles).length,0);
});

test('hosted arena verifies JWT, active session, owner, active save and exact origin before exposing the room',async()=>{
  const f=fixture();
  assert.equal((await f.handler(f.request(0,undefined,worlds[0],'https://attacker.example'))).status,403);assert.equal(f.calls.length,0);
  assert.equal((await f.handler(f.request(0,undefined,worlds[1]))).status,403);assert.equal(Object.keys(f.state().profiles).length,0);
  assert.equal((await f.handler(f.request(0,undefined,worlds[0],config.origins[0],'forged'))).status,401);
  f.revoke();assert.equal((await f.call(0)).status,401);assert.equal(Object.keys(f.state().profiles).length,0);
  const inactive=fixture();inactive.inactive();assert.equal((await inactive.call(0)).status,403);
});

test('hosted players share persisted positions after isolate restart; client XP and identity edits are rejected',async()=>{
  const f=fixture();assert.equal((await f.call(0)).status,200);assert.equal((await f.call(1)).status,200);
  assert.equal((await f.call(1)).data.players[0].nickname,'Ada');
  const move={kind:'walk',x:1000,y:480,request_id:randomUUID()};assert.equal((await f.call(0,move)).status,200);
  assert.deepEqual((await f.call(1)).data.players[0].position,[1000,480]);
  assert.deepEqual((await(await f.restart()(f.request(0))).json()).profile.position,[1000,480]);
  assert.equal((await f.call(0,{...move,xp:999})).status,409);
  const bad=await f.call(0,{kind:'walk',x:900,y:500,xp:999,request_id:randomUUID()});assert.equal(bad.status,400);assert.equal(f.state().profiles[worlds[0]].xp,0);
});

test('CAS contention retries the same action and duplicate training cannot allocate a second fight',async()=>{
  const f=fixture();await f.call(0);f.contend(2);
  const request={kind:'practice',request_id:randomUUID()},first=await f.call(0,request);assert.equal(first.status,200);
  assert.equal((await f.call(0,request)).data.match.id,first.data.match.id);assert.equal(f.state().profiles[worlds[0]].xp,0);
  f.contend(4);const before=structuredClone(f.state());
  assert.equal((await f.call(0,{kind:'act',match:first.data.match.id,version:first.data.match.version,action:{kind:'end'},request_id:randomUUID()})).status,503);
  assert.deepEqual(f.state(),before);
});

test('concurrent invitations and acceptance produce one persisted PvP match; outsiders cannot read another save',async()=>{
  const f=fixture();await f.call(0);await f.call(1);
  const invite=await f.call(0,{kind:'challenge',target:worlds[1],request_id:randomUUID()});assert.equal(invite.status,200);
  const id=(await f.call(1)).data.invitations[0].id,body={kind:'accept',invite:id,request_id:randomUUID()};
  const results=await Promise.all([f.call(1,body),f.call(1,body)]);assert.ok(results.every(r=>r.status===200));
  assert.equal(results[0].data.match.id,results[1].data.match.id);assert.equal(Object.keys(f.state().matches).length,1);
  const current=(await f.call(0)).data.match;assert.equal(current.deadline,(await f.call(1)).data.match.deadline);
});

test('simultaneous knockout retries award winning XP exactly once and never deduct loser XP',async()=>{
  const f=fixture();await f.call(0);await f.call(1);
  const state=f.state(),match=makeDuel(randomUUID(),[state.profiles[worlds[0]],state.profiles[worlds[1]]],Date.now(),0);
  match.players[0].pos={x:1,y:2};match.players[1].pos={x:2,y:2};match.players[1].hp=1;state.matches[match.id]=match;
  const body={kind:'act',match:match.id,version:match.version,action:{kind:'cast',skill:'shiv',target:worlds[1]},request_id:randomUUID()};
  const results=await Promise.all([f.call(0,body),f.call(0,body)]);assert.ok(results.every(r=>r.status===200));
  assert.equal(f.state().profiles[worlds[0]].xp,20);assert.equal(f.state().profiles[worlds[0]].wins,1);assert.equal(f.state().profiles[worlds[1]].xp,0);assert.equal(f.state().profiles[worlds[1]].losses,1);
  assert.equal((await f.call(0,body)).data.profile.xp,20);
});

test('a lost database acknowledgement returns 503, and the same request reconciles the already saved action once',async()=>{
  const f=fixture();await f.call(0);f.loseCommit();
  const body={kind:'practice',request_id:randomUUID()};assert.equal((await f.call(0,body)).status,503);
  const id=f.state().practice![worlds[0]].id;
  const retry=await f.call(0,body);assert.equal(retry.status,200);assert.equal(retry.data.match.id,id);assert.equal(f.state().profiles[worlds[0]].xp,0);
});

test('invalid combat actions are definite rejections, preserve the match and do not block the next valid turn',async()=>{
  const f=fixture();await f.call(0);const practice=await f.call(0,{kind:'practice',request_id:randomUUID()});
  const match=f.state().practice![worlds[0]],actor=match.players[0];actor.mp=0;actor.ap=2;
  const before=structuredClone(f.state());
  const invalid=[{kind:'move',x:actor.pos.x+1,y:actor.pos.y},{kind:'cast',skill:'shiv',target:match.players[1].id}];
  for(const action of invalid){
    const response=await f.call(0,{kind:'act',match:match.id,version:match.version,action,request_id:randomUUID()});
    assert.equal(response.status,400);assert.match(response.data.error,/movement|reach|action points/i);assert.deepEqual(f.state(),before);
  }
  assert.equal((await f.call(0,{kind:'act',match:match.id,version:match.version,action:{kind:'end'},request_id:randomUUID()})).status,200);
  assert.equal(f.state().profiles[worlds[0]].xp,0);assert.ok(practice.data.match);
});
