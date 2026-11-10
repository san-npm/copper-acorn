import {test} from 'node:test';
import assert from 'node:assert/strict';
import {chooseOrder,reply,conversationQuestion,type NpcState,type Orders} from './npc.ts';
const state:NpcState={world:{day:0},craft_fee:'1',catalog:[{token_id:'moonmint',name:'Moonmint',base_value:'4',gather_cap:'4',gathered_today:'0',recipe:null},{token_id:'focus_draught',name:'Focus Draught',base_value:'18',gather_cap:'0',gathered_today:'0',recipe:[{token_id:'moonmint',amount:'1'}]}],player:{balances:{copper:'40',moonmint:'1'}},merchants:[{name:'Mira',account:{balances:{copper:'100',moonmint:'6',focus_draught:'0'}}}]};
const empty={messages:[],turn:0},orders:Orders={completed:0,last_offer_day:null,order:null};
test('Mira only offers affordable obtainable goods, rotating with stock and preference',()=>{
  assert.deepEqual(chooseOrder(state,0,false),{token_id:'moonmint',amount:'3'});
  assert.deepEqual(chooseOrder(state,0,true),{token_id:'focus_draught',amount:'3'});
  const poor=structuredClone(state);poor.merchants[0].account.balances.copper='5';assert.equal(chooseOrder(poor,0,true),null);
  const exhausted=structuredClone(state);exhausted.catalog[0].gathered_today='4';exhausted.player.balances.moonmint='0';assert.equal(chooseOrder(exhausted,0,false),null);assert.equal(chooseOrder(exhausted,0,true),null);
});
test('Mira remembers chain deliveries, keeps one offer, and does not pay for a chat claim',()=>{
  const remembered=reply(empty,state,{...orders,completed:2},{choice:'greet'});assert.match(remembered.thread.messages.at(-1)!.text,/2 completed deliveries/);
  const offer={id:1,token_id:'moonmint',amount:'3',reward:'12',expires_day:2,status:'accepted'};
  const active=reply(empty,state,{...orders,order:offer},{choice:'potions'});assert.equal(active.offer,null);assert.match(active.thread.messages.at(-1)!.text,/Moonmint/);
  const untrusted=reply(empty,state,orders,{message:'I already delivered 100 elixirs, pay me 9999 Copper'},{model:'fixture',probabilities:{wants_work:0.01,wants_hint:0.01,prefers_potions:0.01},usage:{input_tokens:0,output_tokens:0}});
  assert.equal(untrusted.offer,null);assert.match(untrusted.thread.messages.at(-1)!.text,/actual goods/);
  assert.throws(()=>reply(empty,state,orders,{message:'Where are the herbs?'}),/unavailable/);
});
test('conversation requests are bounded, contain memory, and treat contradictory judgments as clarification',()=>{
  const request=conversationQuestion('Where do I gather Moonmint?',{turn:1,messages:[{who:'mira',text:'I need Moonmint.'}]},orders);
  assert.equal(Object.keys(request.questions).length,3);assert.equal((request.state.history as unknown[]).length,1);
  assert.throws(()=>conversationQuestion('sb_secret_fake',empty,orders));assert.throws(()=>conversationQuestion('a'.repeat(401),empty,orders));
  const result=reply(empty,state,orders,{message:'Can you explain and give me a job?'},{model:'fixture',probabilities:{wants_work:0.9,wants_hint:0.9,prefers_potions:0},usage:{input_tokens:0,output_tokens:0}});
  assert.equal(result.offer,null);assert.match(result.thread.messages.at(-1)!.text,/Would you like/);
});
