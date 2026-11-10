import {createClient} from '@supabase/supabase-js';
import {Buffer} from 'node:buffer';
import {arenaStep,type Store,type ArenaIdentity} from '../../../backend/arena-engine.ts';
import {activeSession} from '../_shared/session.ts';
import {view} from '../game-api/near.ts';
import {classes,type CharacterId} from '../../../backend/combat.ts';
import {confirmHostedResults} from '../_shared/referee.ts';

type Config={url:string;publishableKey:string;secretKey:string;origins:string[];background?:(task:Promise<void>)=>void};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export function createArenaHandler(config:Config,fetcher:typeof fetch=fetch){
  let settling:Promise<void>|undefined,nextSettlement=0;
  return async(request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin'),headers:Record<string,string>={'Cache-Control':'no-store',Vary:'Origin'};
    const reply=(status:number,body:unknown)=>Response.json(body,{status,headers});
    if(origin&&!config.origins.includes(origin))return reply(403,{error:'Origin is not allowed.'});
    if(origin)headers['Access-Control-Allow-Origin']=origin;
    headers['Access-Control-Allow-Headers']='authorization,apikey,content-type,x-client-info';headers['Access-Control-Allow-Methods']='GET,POST,OPTIONS';
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
    if(!['GET','POST'].includes(request.method))return reply(405,{error:'Unsupported method.'});
    const url=new URL(request.url),id=url.searchParams.get('world_id'),bearer=request.headers.get('authorization')||'';
    if(url.searchParams.getAll('world_id').length!==1||!uuid(id))return reply(400,{error:'Choose a saved game.'});
    if(!bearer.startsWith('Bearer ')||bearer.length>8192)return reply(401,{error:'Sign in to enter the arena.'});
    try{
      let body:Record<string,unknown>|null=null;
      if(request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json'))return reply(415,{error:'JSON is required.'});
        const reader=request.body?.getReader();if(!reader)return reply(400,{error:'Missing request.'});
        let size=0;const chunks:Uint8Array[]=[];
        while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();return reply(413,{error:'Arena request too large.'});}chunks.push(value);}
        try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reply(400,{error:'Invalid JSON.'});}
        if(!body||typeof body!=='object'||Array.isArray(body))return reply(400,{error:'Invalid request.'});
      }
      const options={auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:fetcher}};
      const auth=createClient(config.url,config.publishableKey,options),verified=await auth.auth.getUser(bearer.slice(7)),user=verified.data.user;
      if(verified.error||!user)return reply(401,{error:'Sign-in could not be verified.'});
      if(user.is_anonymous||!user.email_confirmed_at)return reply(403,{error:'Use a verified account.'});
      const db=createClient(config.url,config.secretKey,options),session=await activeSession(db,bearer,user.id);
      if(!session)return reply(401,{error:'This session has ended. Sign in again.'});
      const world=await db.from('game_worlds').select('id,status,contract_id,is_active,ownership_mode').eq('id',id).eq('user_id',user.id).maybeSingle();
      if(world.error)return reply(503,{error:'Your saved game could not be confirmed.'});
      if(!world.data||world.data.status!=='ready'||!world.data.is_active||typeof world.data.contract_id!=='string')return reply(403,{error:'Enter your active saved game first.'});
      let identity:ArenaIdentity|undefined;
      for(let attempt=0;attempt<4;attempt++){
        const loaded=await db.from('game_arena_state').select('revision,state').eq('singleton',true).single();
        if(loaded.error||!loaded.data||!Number.isSafeInteger(loaded.data.revision))return reply(503,{error:'Arena storage could not be confirmed.'});
        const original=loaded.data.state as Store;
        if(original.version!==1||!original.profiles||!original.matches||!original.requests||!Array.isArray(original.invites))return reply(503,{error:'Arena save format is unsupported. Existing progress was preserved.'});
        if((!original.profiles[id]||world.data.ownership_mode==='owned'&&!original.wallets?.[id])&&!identity){
          const saved=await view(world.data.contract_id,'game_view',{},fetcher);
          if(saved.batch_limit===10)identity=saved.alchemist||undefined;
          else if(saved.batch_limit===undefined&&saved.alchemist===undefined&&typeof saved.player?.account_id==='string'){
            const character=user.user_metadata?.character_id;
            if(typeof character==='string'&&Object.hasOwn(classes,character))identity={character_id:character as CharacterId,nickname:classes[character as CharacterId].name};
          }
          if(!identity)return reply(409,{error:'Choose and save your character before entering the arena.'});
          if(world.data.ownership_mode==='owned'){
            const wallet=await db.from('game_owned_wallets').select('account_id').eq('world_id',id).eq('user_id',user.id).single();
            if(wallet.error||wallet.data.account_id!==saved.player?.account_id)return reply(409,{error:'Your player-owned wallet could not be verified.'});
            identity={...identity,wallet:wallet.data.account_id};
          }
        }
        const result=arenaStep(original,id,identity,request.method,body,Date.now());
        if(result.changed){
          const commit=await db.rpc('commit_game_arena',{p_owner:user.id,p_session:session,p_world:id,p_revision:loaded.data.revision,p_state:result.state});
          if(commit.error)return reply(503,{error:'Arena save could not be confirmed. Retry the same action.'});
          if(commit.data!==true)continue;
        }
        if(result.conflict)return reply(409,{error:result.conflict});
        if(!settling&&Date.now()>=nextSettlement&&Object.values(result.state.settlements||{}).some(r=>r.status==='pending')){
          nextSettlement=Date.now()+5000;
          settling=confirmHostedResults(db,fetcher).catch(()=>undefined).finally(()=>{settling=undefined;});
          config.background?.(settling);
        }
        return reply(200,result.view);
      }
      return reply(503,{error:'The arena is busy. Retry the same action.'});
    }catch(error){
      const e=error as Error&{status?:number};
      return reply(e.status||503,{error:e.status?e.message:'The arena could not be confirmed. Existing progress was preserved.'});
    }
  };
}
