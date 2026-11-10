import {createHash} from 'node:crypto';
import {conversationQuestion,reply,type NpcInput,type Thread,type Orders} from '../../../backend/npc.ts';
import {evaluate,requestBody,type NoulResult} from '../../../backend/jev.ts';
import {dbCall,execute,namesFor,operation,reconcile,publicOperation,snapshot,type Context} from './game.ts';
import {actions,TGAS,view} from './near.ts';

const hash=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function npc(c:Context,body:Record<string,unknown>|null,apiKey:string){
  const contract=namesFor(c).contract;
  if(body)for(const prefix of ['mira-expire-','mira-offer-']){const prior=await operation(c,prefix+body.request_id);if(prior&&(await reconcile(c,prior)).status!=='confirmed')throw Error('Mira’s previous action is awaiting confirmation.');}
  let orders:Orders=await view(contract,'mira_orders_view',{},c.fetcher);
  const saved=await c.db.from('game_npc_threads').select('thread').eq('world_id',c.world.id).eq('npc','mira').maybeSingle();
  if(saved.error)throw Error('Conversation could not be restored.');
  const thread:Thread=saved.data?.thread||{turn:0,messages:[]};
  const availability=async()=>{
    const {data,error}=await c.db.from('game_npc_budget').select('*').eq('singleton',true).single();
    return !!apiKey&&!error&&data.requests_used<data.request_limit&&data.tokens_used+data.tokens_reserved+3000<=data.token_limit;
  };
  if(!body)return {thread,orders,chat_available:await availability()};
  const input:NpcInput=body.message!==undefined?{message:body.message as string}:{choice:body.choice as 'greet'|'work'|'potions'|'hint'};
  if('message' in input)conversationQuestion(input.message,thread,orders);
  else if(!['greet','work','potions','hint'].includes(input.choice))throw Error('Choose an available conversation.');
  const params={p_owner:c.owner,p_session:c.session,p_world:c.world.id,p_request:body.request_id};
  const turn=await dbCall(c,'begin_npc_turn',{...params,p_hash:hash(input)});
  if(!turn.claimed){if(turn.status==='done')return turn.result;throw Error('This message is awaiting confirmation. Use the same request to check it.');}
  try{
    let result:NoulResult|undefined;
    if('message' in input){
      if(!apiKey)throw Error('Jev chat is unavailable. Use a conversation choice.');
      const question=conversationQuestion(input.message,thread,orders);
      // Keep 1,000 tokens of the 3,000-token reservation for service prompt overhead.
      while(new TextEncoder().encode(requestBody(question)).length>2000&&(question.state.history as unknown[]).length)(question.state.history as unknown[]).shift();
      if(new TextEncoder().encode(requestBody(question)).length>2000)throw Error('Use a shorter game message.');
      const reserved=await dbCall(c,'reserve_npc_judgment',{...params,p_hash:hash(question)});
      if(reserved.result)result=reserved.result;
      else if(reserved.claimed){
        result=await evaluate(question,apiKey,c.fetcher);
        if(!await dbCall(c,'finish_npc_judgment',{p_world:c.world.id,p_request:body.request_id,p_claim:reserved.claim_id,p_result:result}))throw Error('Jev result could not be saved.');
        if(result.usage.input_tokens>3000)throw Error('Jev usage exceeded the reserved allowance; chat is paused.');
      }else throw Error('The earlier Jev request was not confirmed. It will not be sent again.');
    }
    const state=await snapshot(c);
    if(orders.order&&['offered','accepted'].includes(orders.order.status)&&state.world.day>=orders.order.expires_day){
      const op=await execute(c,'mira-expire-'+body.request_id,{kind:'npc_expire',request_id:body.request_id},async()=>({role:'mira',receiver:contract,actions:[actions.functionCall('expire_mira_order',{},20n*TGAS,0n)]}));
      if(op.status!=='confirmed')throw Error('The previous order is awaiting confirmation.');
      orders=await view(contract,'mira_orders_view',{},c.fetcher);
    }
    const response=reply(thread,state,orders,input,result);
    if(response.offer){
      const offer=response.offer;
      const op=await execute(c,'mira-offer-'+body.request_id,{kind:'npc_offer',request_id:body.request_id,...offer},async()=>({role:'mira',receiver:contract,actions:[actions.functionCall('offer_mira_order',offer,20n*TGAS,1n)]}));
      if(op.status!=='confirmed')throw Error(publicOperation(op).error||'Mira’s payment reservation is awaiting confirmation.');
      orders=await view(contract,'mira_orders_view',{},c.fetcher);
      const o=orders.order!,name=state.catalog.find((i:any)=>i.token_id===o.token_id)?.name;
      response.thread.messages.at(-1)!.text=`Could you bring me ${o.amount} ${name}? I have set aside ${o.reward} Copper. Choose Accept; it expires after market day ${o.expires_day}.`;
    }
    const answer={thread:response.thread,orders,chat_available:await availability()};
    if(!await dbCall(c,'finish_npc_turn',{...params,p_claim:turn.claim_id,p_thread:response.thread,p_result:answer,p_error:null}))throw Error('Conversation confirmation expired. Check the same message.');
    return answer;
  }catch(error){
    // Release the conversation lock, retaining inference reservations and signed offers for exact recovery.
    await dbCall(c,'finish_npc_turn',{...params,p_claim:turn.claim_id,p_thread:null,p_result:null,p_error:'Conversation could not be confirmed. Choices remain available; uncertain inference will not be repeated.'}).catch(()=>undefined);
    throw error;
  }
}
