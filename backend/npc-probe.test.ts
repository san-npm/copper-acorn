import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {requestBody} from './jev.ts';
import {conversationQuestion,reply} from './npc.ts';

test('NPC probe spends at most its approved batch, stops on uncertainty/budget and refuses a rerun',()=>{
  for(const [status,tokens,count,expected] of [[200,418,3,'completed'],[200,3900,1,'budget_stopped'],[402,0,1,'failed']] as const){
    const dir=mkdtempSync(join(tmpdir(),'npc-probe-'));
    try{
      for(const path of ['backend/fixtures','scripts'])mkdirSync(join(dir,path),{recursive:true});
      for(const path of ['backend/jev.ts','backend/fixtures/npc-probe.json','scripts/npc-probe.ts'])copyFileSync(new URL('../'+path,import.meta.url),join(dir,path));
      writeFileSync(join(dir,'package.json'),'{"type":"module"}');
      writeFileSync(join(dir,'api.mjs'),`import {appendFileSync} from 'node:fs';globalThis.fetch=async()=>{appendFileSync('calls','1');return Response.json({model:'fixture',answers:{wants_work:{type:'noul',noul:.8},wants_hint:{type:'noul',noul:.1},prefers_potions:{type:'noul',noul:.1}},usage:{input_tokens:${tokens},output_tokens:60}},{status:${status}})};`);
      const run=()=>spawnSync(process.execPath,['--import','./api.mjs','scripts/npc-probe.ts','--run'],{cwd:dir,env:{...process.env,TYPESAFE_API_KEY:'fixture'},encoding:'utf8'});
      run();assert.equal(readFileSync(join(dir,'calls'),'utf8').length,count);
      const record=JSON.parse(readFileSync(join(dir,'.local/npc-probe.json'),'utf8'));assert.equal(record.status,expected);assert.ok(record.input_tokens<=4000);
      assert.notEqual(run().status,0);assert.equal(readFileSync(join(dir,'calls'),'utf8').length,count);
    }finally{rmSync(dir,{recursive:true,force:true});}
  }
});
test('recorded live NPC evidence matches exactly the three prepared fictional payloads',()=>{
  const prepared=JSON.parse(readFileSync(new URL('./fixtures/npc-probe.json',import.meta.url),'utf8'));
  const actual=JSON.parse(readFileSync(new URL('./fixtures/npc-live-probe.json',import.meta.url),'utf8'));
  assert.equal(actual.status,'completed');assert.equal(actual.requests,3);assert.equal(actual.input_tokens,1259);assert.equal(actual.cases.length,3);
  actual.cases.forEach((entry:any,i:number)=>{assert.deepEqual(entry.request,prepared.requests[i]);assert.equal(entry.request_sha256,createHash('sha256').update(requestBody(entry.request)).digest('hex'));});
});
test('the owned-release Jev probe routes a fictional potion preference to an obtainable finite order',()=>{
  const live=JSON.parse(readFileSync(new URL('./fixtures/owned-npc-live-probe.json',import.meta.url),'utf8'));
  assert.equal(live.status,'answered');assert.equal(live.result.usage.input_tokens,424);assert.equal(live.result.usage.output_tokens,60);
  const request=conversationQuestion(live.input.message,live.thread,live.orders);
  assert.equal(createHash('sha256').update(requestBody(request)).digest('hex'),live.request_sha256);
  assert.deepEqual(reply(live.thread,live.state,live.orders,live.input,live.result),live.response);
  assert.deepEqual(live.response.offer,{token_id:'healing_tonic',amount:'1'});
});
