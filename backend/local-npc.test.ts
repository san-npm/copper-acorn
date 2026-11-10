import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer,type Server} from 'node:http';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {localNpc} from './local-npc.ts';

test('Mira persists one funded offer per request, remembers verified deliveries and refuses unavailable live chat',async()=>{
  const folder=await mkdtemp(join(tmpdir(),'copper-npc-')),file=join(folder,'threads.json'),world='sandbox-1794243244981656000';
  let offered=0,external=0,base='',server:Server;
  const orders:any={completed:0,last_offer_day:null,order:null};
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);if(!url.startsWith('http://127.0.0.1:1/')){external++;throw Error('No model calls allowed.');}
    if(url.includes('/api/state?'))return Response.json({environment:{player_owned:true,world_id:world},world:{day:0},craft_fee:'1',catalog:[{token_id:'moonmint',name:'Moonmint',base_value:'4',gather_cap:'4',gathered_today:'0',recipe:null}],player:{balances:{copper:'40',moonmint:'1'}},merchants:[{name:'Mira',account:{balances:{copper:'100',moonmint:'6'}}}]});
    const body=JSON.parse(String(init?.body));if(body.method==='offer'){offered++;orders.last_offer_day=0;orders.order={id:1,token_id:body.token_id,amount:body.amount,reward:'12',expires_day:2,status:'offered'};}
    return Response.json(orders);
  };
  async function start(){const handler=localNpc({file,apiBase:'http://127.0.0.1:1',fetcher});server=createServer((q,r)=>handler(q,r,()=>r.end()));await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as {port:number}).port;}
  const stop=()=>new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
  const call=async(body?:object,origin?:string)=>{const response=await fetch(base+'/api/npc?world_id='+world,{method:body?'POST':'GET',headers:{Origin:origin||base,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json() as any};};
  await start();
  try{
    assert.equal((await call(undefined,'https://untrusted.example')).status,403);
    const work={request_id:randomUUID(),choice:'work'};assert.equal((await call(work)).status,200);assert.equal((await call(work)).status,200);assert.equal(offered,1);
    assert.equal((await call({...work,choice:'potions'})).status,409);
    assert.equal((await call({request_id:randomUUID(),message:'Can I have potion work?'})).status,503);assert.equal(external,0);
    orders.completed=1;orders.order.status='completed';await stop();await start();
    const greet=await call({request_id:randomUUID(),choice:'greet'});assert.match(greet.body.thread.messages.at(-1).text,/1 completed delivery/);
    assert.equal((await stat(file)).mode&0o077,0);assert.equal(JSON.parse(await readFile(file,'utf8')).used,0);
  }finally{await stop();await rm(folder,{recursive:true,force:true});}
});
