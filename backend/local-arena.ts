import {readFile,writeFile,rename,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {classes,type CharacterId} from './combat.ts';
import {settlePending,type Referee} from './arena-settlement.ts';
import {arenaStep,type Store,type ArenaIdentity} from './arena-engine.ts';

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const worldId=(v:unknown):v is string=>uuid(v)||typeof v==='string'&&/^sandbox-[0-9]{16,20}$/.test(v);
// shortcut: one writer for this private loopback playtest; use authenticated transactional hosting before public multiplayer.
export function localArena(options:{apiBase:string;file:string;clock?:()=>number;fetcher?:typeof fetch;refereeToken?:string}){
  const clock=options.clock||Date.now,fetcher=options.fetcher||fetch;
  let loaded:Store|undefined,queue:Promise<unknown>=Promise.resolve();
  const verified=new Map<string,ArenaIdentity>();
  async function load(){
    if(loaded)return loaded;
    try{
      const value=JSON.parse(await readFile(options.file,'utf8'));
      if(value.version!==1||!value.profiles||!value.matches||!Array.isArray(value.invites)||!value.requests)throw Object.assign(Error('Arena save format is unsupported. Existing data was preserved.'),{status:503});
      loaded=value as Store;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')loaded={version:1,profiles:{},matches:{},invites:[],requests:{}};else throw error;}
    return loaded!;
  }
  async function save(next:Store){
    await mkdir(dirname(options.file),{recursive:true});
    const temporary=options.file+'.'+randomUUID()+'.tmp';
    await writeFile(temporary,JSON.stringify(next),{mode:0o600,flag:'wx'});
    await rename(temporary,options.file);loaded=next;
  }
  async function dispatch(id:string,method:string,body:Record<string,unknown>|null){
    let identity=verified.get(id);
    if(!identity){
      const response=await fetcher(options.apiBase+'/api/state?world_id='+encodeURIComponent(id),{signal:AbortSignal.timeout(15_000)});
      if(!response.ok)throw Object.assign(Error('This local shop is not available. Select an existing saved game.'),{status:409});
      const state=await response.json();
      if(state.environment?.network!=='sandbox'||state.environment.world_id!==id||!state.alchemist||!Object.hasOwn(classes,state.alchemist.character_id))throw Object.assign(Error('Choose and save your alchemist before entering the arena.'),{status:409});
      identity={...state.alchemist,...(state.environment.player_owned?{wallet:state.player.account_id}:{})} as ArenaIdentity;
    }
    const result=arenaStep(await load(),id,identity,method,body,clock());
    if(result.changed)await save(result.state);
    verified.set(id,identity);
    if(result.conflict)throw Object.assign(Error(result.conflict),{status:409});
    launchSettlement();
    return result.view;
  }
  let settling=false,nextSettlement=0;
  function launchSettlement(){
    if(settling||!options.refereeToken||clock()<nextSettlement||!Object.values(loaded?.settlements||{}).some(r=>r.status==='pending'))return;
    settling=true;nextSettlement=clock()+5000;
    const call=async(method:string,args:object)=>{
      const response=await fetcher(options.apiBase+'/api/owned/referee',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+options.refereeToken},body:JSON.stringify({method,args}),signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw Error('NEAR result confirmation is pending.');return response.json();
    };
    const referee:Referee={result:match_id=>call('result',{match_id}),settle:result=>call('settle_duel',{result}),progress:(account_id,save_id)=>call('progress',{account_id,...(save_id?{save_id}:{})})};
    void settlePending(loaded!,referee).then(confirmed=>{
      const commit=async()=>{
        const current=structuredClone(await load());
        for(const [id,r] of Object.entries(confirmed.settlements||{})){
          if(r.status!=='confirmed'||current.settlements?.[id]?.status!=='pending')continue;
          current.settlements[id]=r;
          for(const p of current.matches[id].players){const synced=confirmed.profiles[p.id];Object.assign(current.profiles[p.id],{xp:synced.xp,wins:synced.wins,losses:synced.losses});}
        }
        await save(current);
      };
      const committed=queue.then(commit,commit);queue=committed.catch(()=>undefined);return committed;
    }).catch(()=>{/* Keep the saved receipt pending; never block courtyard actions on a chain outage. */}).finally(()=>{settling=false;});
  }
  return (request:IncomingMessage,response:ServerResponse,next:()=>void)=>{
    const address=new URL(request.url||'/','http://localhost');if(address.pathname!=='/api/arena')return next();
    const reply=(status:number,body:unknown)=>{response.statusCode=status;response.setHeader('Content-Type','application/json');response.setHeader('Cache-Control','no-store');response.end(JSON.stringify(body));};
    const host=request.headers.host,origin=request.headers.origin;
    if(!host||!/^(127\.0\.0\.1|localhost):\d{1,5}$/.test(host)||origin&&origin!==`http://${host}`||request.method==='POST'&&!origin)return reply(403,{error:'Local arena origin required.'});
    if(!['GET','POST'].includes(request.method||''))return reply(405,{error:'Unsupported method.'});
    const id=address.searchParams.get('world_id');if(address.searchParams.getAll('world_id').length!==1||!worldId(id))return reply(400,{error:'Choose a local saved game.'});
    void(async()=>{
      let body:Record<string,unknown>|null=null;
      if(request.method==='POST'){
        if(!request.headers['content-type']?.startsWith('application/json'))return reply(415,{error:'JSON is required.'});
        let raw='';for await(const chunk of request){raw+=chunk.toString();if(Buffer.byteLength(raw)>4096)return reply(413,{error:'Arena request too large.'});}
        try{body=JSON.parse(raw);}catch{return reply(400,{error:'Invalid JSON.'});}
        if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Invalid request.'});
      }
      const run=()=>dispatch(id,request.method!,body);
      const result=queue.then(run,run);queue=result.catch(()=>undefined);
      reply(200,await result);
    })().catch(error=>{
      const internal=error.code||['SyntaxError','TypeError'].includes(error.name);
      reply(internal?503:typeof error.status==='number'?error.status:400,{error:internal?'Arena storage could not be confirmed. Existing progress was preserved.':error.message||'The arena could not be confirmed.'});
    });
  };
}
