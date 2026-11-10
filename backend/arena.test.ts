import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localArena} from './local-arena.ts';
import {makeDuel,type Profile} from './combat.ts';
import {arenaSpawn} from '../web/src/arena-layout.ts';

const a='sandbox-1794145388830087000',b='20000000-0000-4000-8000-000000000002',c='30000000-0000-4000-8000-000000000003';
async function setup(){
  const folder=await mkdtemp(join(tmpdir(),'copper-arena-')),file=join(folder,'arena.json');let now=100_000,server:Server,base='';
  const start=async()=>{
    const handler=localArena({apiBase:'http://127.0.0.1:1',file,clock:()=>now,fetcher:async(input)=>{
      const id=new URL(String(input)).searchParams.get('world_id');
      return Response.json({environment:{network:'sandbox',world_id:id},alchemist:{nickname:id===a?'Ada':id===b?'Bram':'Cora',character_id:id===a?'goblin':'elf'}});
    }});
    server=createServer((req,res)=>handler(req,res,()=>{res.statusCode=404;res.end();}));
    await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;
  };
  const stop=()=>new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
  await start();
  const call=async(id:string,body?:Record<string,unknown>)=>{
    const response=await fetch(base+'/api/arena?world_id='+id,{method:body?'POST':'GET',headers:{Origin:base,...body?{'Content-Type':'application/json'}:{}},body:body?JSON.stringify(body):undefined});
    return {status:response.status,data:await response.json() as any};
  };
  return {file,call,base:()=>base,setNow:(value:number)=>{now=value;},restart:async()=>{await stop();await start();},close:async()=>{await stop();await rm(folder,{recursive:true,force:true});}};
}

test('arena invites require the recipient, allow every level, and validate actor/skill ownership',async()=>{
  const s=await setup();try{
    await s.call(a);await s.call(b);await s.call(c);
    const challenge={kind:'challenge',target:b,request_id:randomUUID()};assert.equal((await s.call(a,challenge)).status,200);
    const invite=(await s.call(b)).data.invitations[0];
    assert.equal((await s.call(a,{kind:'accept',invite:invite.id,request_id:randomUUID()})).status,403);
    const accepted=await s.call(b,{kind:'accept',invite:invite.id,request_id:randomUUID()});assert.equal(accepted.status,200);
    const match=accepted.data.match,actor=match.players[match.active].id,outsider=c;
    assert.equal((await s.call(outsider,{kind:'act',match:match.id,version:match.version,action:{kind:'end'},request_id:randomUUID()})).status,403);
    const before=await readFile(s.file,'utf8');
    const invalid=await s.call(actor,{kind:'act',match:match.id,version:match.version,action:{kind:'cast',skill:'not-my-skill',target:actor===a?b:a},request_id:randomUUID()});
    assert.equal(invalid.status,400);assert.equal(await readFile(s.file,'utf8'),before);
    assert.equal((await s.call(actor,{kind:'act',match:match.id,version:match.version,action:{kind:'end',xp:999},request_id:randomUUID()})).status,400);
  }finally{await s.close();}
});

test('backend expiry survives reload, rejects a late cast, and advances a turn only once',async()=>{
  const s=await setup();try{
    await s.call(a);await s.call(b);await s.call(a,{kind:'challenge',target:b,request_id:randomUUID()});
    const invite=(await s.call(b)).data.invitations[0];
    const original=(await s.call(b,{kind:'accept',invite:invite.id,request_id:randomUUID()})).data.match;
    s.setNow(original.deadline-1);assert.equal((await s.call(a)).data.match.version,original.version);
    s.setNow(original.deadline);
    const late={kind:'act',match:original.id,version:original.version,action:{kind:'end'},request_id:randomUUID()};
    assert.equal((await s.call(original.players[original.active].id,late)).status,409);
    const next=(await s.call(a)).data.match;assert.equal(next.active,1-original.active);assert.equal(next.deadline,original.deadline+60_000);assert.equal(next.version,original.version+1);
    assert.equal((await s.call(a,late)).status,409);assert.equal((await s.call(a)).data.match.version,next.version);
    await s.restart();assert.equal((await s.call(b)).data.match.deadline,next.deadline);assert.equal((await s.call(a)).data.match.version,next.version);
  }finally{await s.close();}
});

test('knockout awards scaled XP once, never removes loser XP, and restores across a server restart',async()=>{
  const s=await setup();try{
    const pa:Profile={id:a,nickname:'Ada',character:'goblin',xp:0,wins:0,losses:0},pb:Profile={id:b,nickname:'Bram',character:'elf',xp:60,wins:0,losses:0};
    const match=makeDuel(randomUUID(),[pa,pb],100_000,0);match.players[0].pos={x:1,y:2};match.players[1].pos={x:2,y:2};match.players[1].hp=1;
    await writeFile(s.file,JSON.stringify({version:1,profiles:{[a]:pa,[b]:pb},matches:{[match.id]:match},invites:[],requests:{}}),{mode:0o600});
    await s.restart();
    const body={kind:'act',match:match.id,version:0,action:{kind:'cast',skill:'shiv',target:b},request_id:randomUUID()};
    const won=await s.call(a,body);assert.equal(won.status,200);assert.equal(won.data.match.result.winner,a);assert.equal(won.data.profile.xp,62);assert.equal(won.data.profile.wins,1);assert.equal(won.data.match.visuals.length,1);assert.equal(won.data.match.visuals[0].skill,'shiv');assert.equal(won.data.match.visuals[0].changes.find((u:any)=>u.id===b).hp,-1);
    assert.equal((await s.call(b)).data.profile.xp,60);assert.equal((await s.call(b)).data.profile.losses,1);
    const replay=await s.call(a,body);assert.equal(replay.data.profile.xp,62);assert.equal(replay.data.match.visuals.length,1);
    assert.equal((await s.call(a,{...body,request_id:randomUUID()})).status,409);
    await s.restart();assert.equal((await s.call(a)).data.profile.xp,62);assert.equal((await s.call(a)).data.profile.wins,1);
    assert.equal((await stat(s.file)).mode&0o077,0);
    assert.equal((await s.call(a,{...body,action:{kind:'end'}})).status,409);
  }finally{await s.close();}
});

test('foreign origins, malformed bodies and a damaged save fail without silently resetting progress',async()=>{
  const s=await setup();try{
    let r=await fetch(s.base()+'/api/arena?world_id='+a,{headers:{Origin:'https://untrusted.example'}});assert.equal(r.status,403);
    r=await fetch(s.base()+'/api/arena?world_id='+a,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,403);
    r=await fetch(s.base()+'/api/arena?world_id='+a,{method:'POST',headers:{Origin:s.base(),'Content-Type':'application/json'},body:'{'});assert.equal(r.status,400);
    await writeFile(s.file,'damaged arena data');await s.restart();
    assert.equal((await s.call(a)).status,503);assert.equal(await readFile(s.file,'utf8'),'damaged arena data');
  }finally{await s.close();}
});
test('concurrent actions serialize, and a replay cannot spend AP or change turns twice',async()=>{
  const s=await setup();try{
    await s.call(a);await s.call(b);await s.call(a,{kind:'challenge',target:b,request_id:randomUUID()});
    const invite=(await s.call(b)).data.invitations[0],match=(await s.call(b,{kind:'accept',invite:invite.id,request_id:randomUUID()})).data.match;
    const actor=match.players[match.active].id,body={kind:'act',match:match.id,version:match.version,action:{kind:'end'},request_id:randomUUID()};
    const replies=await Promise.all([s.call(actor,body),s.call(actor,body)]);assert.deepEqual(replies.map(r=>r.status),[200,200]);
    assert.equal((await s.call(actor)).data.match.version,match.version+1);
    assert.equal((await s.call(actor,{...body,action:{kind:'move',x:1,y:2}})).status,409);
    assert.equal((await s.call(actor,{...body,request_id:randomUUID()})).status,409);
    const next=(await s.call(actor)).data.match,nextActor=next.players[next.active].id;
    const action={...body,version:next.version,request_id:randomUUID()};
    const competing=await Promise.all([s.call(nextActor,action),s.call(nextActor,{...action,request_id:randomUUID()})]);
    assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);assert.equal((await s.call(actor)).data.match.version,next.version+1);
  }finally{await s.close();}
});
test('training can stop and restart, never awards XP/records, and keeps normal player invitations separate',async()=>{
  const s=await setup();try{
    await s.call(a);await s.call(b);
    const start={kind:'practice',request_id:randomUUID()};let r=await s.call(a,start);assert.equal(r.status,200);assert.equal(r.data.match.training,true);const id=r.data.match.id;
    assert.equal((await s.call(a,start)).data.match.id,id);
    assert.equal((await s.call(b,{kind:'challenge',target:a,request_id:randomUUID()})).status,409);
    s.setNow(r.data.match.deadline);r=await s.call(a);assert.equal(r.data.match.active,0);assert.equal(r.data.profile.xp,0);assert.equal(r.data.profile.wins,0);
    const stop={kind:'stop-practice',match:id,request_id:randomUUID()};assert.equal((await s.call(a,stop)).data.match,null);assert.equal((await s.call(a,stop)).status,200);
    r=await s.call(a,{kind:'practice',request_id:randomUUID()});assert.notEqual(r.data.match.id,id);assert.equal((await s.call(a,{...stop,request_id:randomUUID()})).status,409);
    await s.restart();r=await s.call(a);assert.equal(r.data.match.training,true);assert.equal(r.data.profile.losses,0);
  }finally{await s.close();}
});
test('knocking out the training target changes no XP, wins, losses or normal match history',async()=>{
  const s=await setup();try{
    const pa:Profile={id:a,nickname:'Ada',character:'goblin',xp:0,wins:0,losses:0},npc:Profile={id:'trainer-'+a,nickname:'Practice Warden',character:'lizard',xp:0,wins:0,losses:0};
    const match=makeDuel(randomUUID(),[pa,npc],100_000);match.training=true;match.players[0].pos={x:1,y:2};match.players[1].pos={x:2,y:2};match.players[1].hp=1;
    await writeFile(s.file,JSON.stringify({version:1,profiles:{[a]:pa},matches:{},practice:{[a]:match},invites:[],requests:{}}));await s.restart();
    const r=await s.call(a,{kind:'act',match:match.id,version:0,action:{kind:'cast',skill:'shiv',target:npc.id},request_id:randomUUID()});
    assert.equal(r.status,200);assert.equal(r.data.match.result.winner,a);assert.deepEqual(r.data.profile,{...pa,level:1,position:arenaSpawn(a)});assert.deepEqual(JSON.parse(await readFile(s.file,'utf8')).matches,{});
  }finally{await s.close();}
});

test('room movement is validated, visible to other players, idempotent and restored',async()=>{
  const s=await setup();try{
    await s.call(a);await s.call(b);const move={kind:'walk',x:900,y:520,request_id:randomUUID()};
    assert.equal((await s.call(a,move)).status,200);assert.deepEqual((await s.call(b)).data.players.find((p:any)=>p.id===a).position,[900,520]);
    assert.equal((await s.call(a,move)).status,200);
    assert.equal((await s.call(a,{kind:'walk',x:50,y:50,request_id:randomUUID()})).status,400);
    assert.deepEqual((await s.call(a)).data.profile.position,[900,520]);
    assert.equal((await s.call(a,{...move,xp:999,request_id:randomUUID()})).status,400);
    await s.restart();assert.deepEqual((await s.call(a)).data.profile.position,[900,520]);
    await s.call(a,{kind:'practice',request_id:randomUUID()});assert.equal((await s.call(a,{...move,request_id:randomUUID()})).status,409);
  }finally{await s.close();}
});
