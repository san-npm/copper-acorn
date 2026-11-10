import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {evaluate,type NoulResult} from './jev.ts';
import {conversationQuestion,reply,type NpcInput,type Thread,type Orders,type NpcState} from './npc.ts';

type Entry={thread:Thread;requests:Record<string,{input:string;status:'preparing'|'judging'|'ready'|'done';judgment?:NoulResult}>};
type Saved={version:1;used:number;worlds:Record<string,Entry>};
// shortcut: private loopback storage; public hosting must use authenticated per-owner database rows.
export function localNpc(options:{file:string;apiBase:string;fetcher?:typeof fetch;apiKey?:string;requestLimit?:number}){
  const fetcher=options.fetcher||fetch;let loaded:Saved|undefined,queue:Promise<unknown>=Promise.resolve();
  async function load(){
    if(loaded)return loaded;
    try{const s=JSON.parse(await readFile(options.file,'utf8'));if(s.version!==1||!s.worlds||!Number.isSafeInteger(s.used))throw Error('Unsupported conversation save.');loaded=s;}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;loaded={version:1,used:0,worlds:{}};}
    return loaded!;
  }
  async function save(s:Saved){await mkdir(dirname(options.file),{recursive:true});const tmp=options.file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(s),{mode:0o600,flag:'wx'});await rename(tmp,options.file);loaded=s;}
  async function api(path:string,body?:object){
    const response=await fetcher(options.apiBase+path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30_000)});
    if(!response.ok)throw Error('Mira’s confirmed stock could not be checked.');return response.json();
  }
  async function dispatch(world:string,body:Record<string,unknown>|null){
    const state:NpcState&{environment:{player_owned?:boolean;world_id:string}}=await api('/api/state?world_id='+world);
    if(!state.environment.player_owned||state.environment.world_id!==world)throw Object.assign(Error('Mira conversations are available in the player-owned local preview.'),{status:409});
    let orders:Orders=await api('/api/owned/mira',{world_id:world,method:'view'});
    const saved=structuredClone(await load());
    if(!saved.worlds[world]&&Object.keys(saved.worlds).length>=128)throw Error('Conversation storage is full. Existing threads were preserved.');
    const entry=saved.worlds[world]??={thread:{messages:[],turn:0},requests:{}};
    const available=()=>!!options.apiKey&&saved.used<(options.requestLimit||0);
    if(!body)return {thread:entry.thread,orders,chat_available:available()};
    const id=body.request_id;
    if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)||Object.keys(body).sort().join(',')!==(body.message!==undefined?'message,request_id':'choice,request_id'))throw Object.assign(Error('Invalid conversation request.'),{status:400});
    let input:NpcInput;
    if(body.message!==undefined){if(typeof body.message!=='string')throw Object.assign(Error('Use a text message.'),{status:400});input={message:body.message};conversationQuestion(body.message,entry.thread,orders);}
    else {if(!['greet','work','potions','hint'].includes(String(body.choice)))throw Object.assign(Error('Choose an available conversation.'),{status:400});input={choice:body.choice as 'greet'|'work'|'potions'|'hint'};}
    const raw=JSON.stringify(input),prior=entry.requests[id];
    if(prior&&prior.input!==raw)throw Object.assign(Error('That request ID belongs to another message.'),{status:409});
    if(prior?.status==='done')return {thread:entry.thread,orders,chat_available:available()};
    if(Object.keys(entry.requests).length>=256&&!prior)throw Error('This conversation reached its private preview limit. Existing messages were preserved.');
    const record=entry.requests[id]??={input:raw,status:'preparing'};
    if('message' in input&&!record.judgment){
      if(record.status==='judging')throw Error('The earlier Jev request was not confirmed; it will not be charged again automatically. Use a conversation button.');
      if(!available())throw Error('Jev chat is unavailable. Use a conversation button; no model judgment was made.');
      const question=conversationQuestion(input.message,entry.thread,orders);
      record.status='judging';saved.used++;await save(saved);
      record.judgment=await evaluate(question,options.apiKey!,fetcher);record.status='ready';await save(saved);
    }
    if(orders.order&&['offered','accepted'].includes(orders.order.status)&&state.world.day>=orders.order.expires_day){await api('/api/owned/mira',{world_id:world,method:'expire'});orders=await api('/api/owned/mira',{world_id:world,method:'view'});}
    const response=reply(entry.thread,state,orders,input,record.judgment);
    if(response.offer){
      await api('/api/owned/mira',{world_id:world,method:'offer',...response.offer});
      orders=await api('/api/owned/mira',{world_id:world,method:'view'});
      const o=orders.order!;const name=state.catalog.find(i=>i.token_id===o.token_id)?.name;
      response.thread.messages.at(-1)!.text=`Could you bring me ${o.amount} ${name}? I have set aside ${o.reward} Copper. Choose Accept to take the order; it expires after market day ${o.expires_day}.`;
    }
    entry.thread=response.thread;record.status='done';await save(saved);
    return {thread:entry.thread,orders,chat_available:available()};
  }
  return (request:IncomingMessage,response:ServerResponse,next:()=>void)=>{
    const url=new URL(request.url||'/','http://localhost');if(url.pathname!=='/api/npc')return next();
    const respond=(status:number,body:unknown)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify(body));};
    const host=request.headers.host,origin=request.headers.origin,world=url.searchParams.get('world_id');
    if(!host||!/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(host)||origin&&origin!==`http://${host}`||request.method==='POST'&&!origin)return respond(403,{error:'Local conversation origin required.'});
    if(!world||!/^sandbox-[0-9]{16,20}$/.test(world)||url.searchParams.getAll('world_id').length!==1)return respond(400,{error:'Choose a local saved game.'});
    if(!['GET','POST'].includes(request.method||''))return respond(405,{error:'Unsupported method.'});
    void(async()=>{
      let body:Record<string,unknown>|null=null;
      if(request.method==='POST'){
        if(!request.headers['content-type']?.startsWith('application/json'))return respond(415,{error:'JSON is required.'});
        let raw='';for await(const chunk of request){raw+=chunk.toString();if(Buffer.byteLength(raw)>2048)return respond(413,{error:'Conversation request too large.'});}
        try{body=JSON.parse(raw);}catch{return respond(400,{error:'Invalid JSON.'});}
        if(!body||typeof body!=='object'||Array.isArray(body))return respond(400,{error:'Invalid conversation.'});
      }
      const run=()=>dispatch(world,body);const result=queue.then(run,run);queue=result.catch(()=>undefined);respond(200,await result);
    })().catch(e=>respond(e.status||503,{error:['SyntaxError','TypeError'].includes(e.name)?'Conversation storage could not be confirmed.':e.message||'Mira is unavailable.'}));
  };
}
