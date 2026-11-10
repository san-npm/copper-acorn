import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveAccountCharacter} from '../web/src/account-character.ts';

const url='https://example.supabase.co',owner='fixture-owner';
const saved=()=>Response.json({id:owner,user_metadata:{character_id:'goblin'}});

test('appearance writes contain only the selected cosmetic and the original account credential',async t=>{
  let calls=0;
  t.mock.method(globalThis,'fetch',async(input:string,init:RequestInit)=>{
    calls++;assert.equal(input,url+'/auth/v1/user');assert.equal(init.method,'PUT');assert.equal(init.redirect,'error');
    assert.equal((init.headers as Record<string,string>).Authorization,'Bearer original-account');
    assert.deepEqual(JSON.parse(init.body as string),{data:{character_id:'goblin'}});return saved();
  });
  await saveAccountCharacter(url,'public-fixture','original-account',owner,'goblin',()=>true);assert.equal(calls,1);
});

test('unavailable appearances and an already-changed account cannot send a write',async t=>{
  let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return saved();});
  for(const id of ['','goblin\n','__proto__','another-character'])await assert.rejects(saveAccountCharacter(url,'public','token',owner,id,()=>true));
  await assert.rejects(saveAccountCharacter(url,'public','token',owner,'goblin',()=>false),/account changed/);assert.equal(calls,0);
});

test('a different owner, wrong character or rejected response cannot confirm the cosmetic',async t=>{
  let reply=saved();t.mock.method(globalThis,'fetch',async()=>reply);
  for(const [body,status] of [[{id:'another-owner',user_metadata:{character_id:'goblin'}},200],[{id:owner,user_metadata:{character_id:'elf'}},200],[{id:owner,user_metadata:{character_id:'goblin'}},403],[null,200]] as const){
    reply=Response.json(body,{status});await assert.rejects(saveAccountCharacter(url,'public','token',owner,'goblin',()=>true),/could not be saved/);
  }
});

test('an acknowledgement arriving after an account switch cannot restore the old appearance',async t=>{
  let current=true,release!:(response:Response)=>void;
  t.mock.method(globalThis,'fetch',()=>new Promise<Response>(resolve=>{release=resolve;}));
  const writing=saveAccountCharacter(url,'public','original-account',owner,'goblin',()=>current);current=false;release(saved());await assert.rejects(writing,/account changed/);
});
