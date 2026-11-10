import { createClient } from '@supabase/supabase-js';
import { Buffer } from 'node:buffer';
import {view} from './near.ts';
import { activeSession } from '../_shared/session.ts';
import { dbCall, execute, operation, planAction, provision, publicOperation, reconcile, snapshot, validateAction, type Context } from './game.ts';
import {walletChallenge,linkWallet,ownedWallet,device,playerQuery,signedPlayerAction,supportRefill} from './owned.ts';
import {npc} from './npc.ts';
import {provisionReferee} from '../_shared/referee.ts';

type Config = { url: string; publishableKey: string; secretKey: string; origins: string[]; wasm: Uint8Array; jevKey?:string;arenaWasm?:Uint8Array };
const uuid = (s: unknown) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(s);
export function createGameHandler(config: Config, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: { [key: string]: string } = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (origin && !config.origins.includes(origin)) return reply(403, { error: 'Origin is not allowed.' });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization,apikey,content-type,x-client-info';
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const url = new URL(request.url), path = url.pathname.split('/game-api')[1], selected = url.searchParams.get('world_id');
    if (url.searchParams.getAll('world_id').length > 1 || selected !== null && !uuid(selected)) return reply(400, { error: 'Invalid shop selection.' });
    if (!path || !['/state','/provision','/action','/saves','/new-game','/select-save','/npc','/wallet-challenge','/wallet-link','/device','/rpc'].includes(path) && !/^\/actions\/[a-zA-Z0-9-]{8,80}$/.test(path)) return reply(404, { error: 'Unknown game route.' });
    if (path==='/npc'?!['GET','POST'].includes(request.method):request.method !== (['/provision','/action','/new-game','/select-save','/wallet-challenge','/wallet-link','/rpc'].includes(path) ? 'POST' : 'GET')) return reply(405, { error: 'Unsupported method.' });
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ') || bearer.length < 16 || bearer.length > 8192) return reply(401, { error: 'Sign in first.' });
    try {
      let body: any = null;
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'JSON is required.' });
        const reader = request.body?.getReader(); let size = 0; const chunks = [];
        if (reader) while (true) { const { value, done } = await reader.read(); if (done) break; size += value.length;
          if (size > (path==='/action'?36_000:2048)) { await reader.cancel(); return reply(413, { error: 'Request is too large.' }); } chunks.push(value); }
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reply(400, { error: 'Invalid JSON.' }); }
        if (!body || Array.isArray(body) || typeof body !== 'object') return reply(400, { error: 'Unsupported request.' });
        if (path === '/provision' && Object.keys(body).length) return reply(400, { error: 'Send an empty object.' });
        if(path==='/wallet-challenge'&&(Object.keys(body).sort().join()!=='request_id,world_id'||!uuid(body.request_id)||body.world_id!==null&&!uuid(body.world_id)))return reply(400,{error:'Invalid wallet challenge.'});
        if(path==='/wallet-link'&&(Object.keys(body).sort().join()!=='challenge_id,proof'||!uuid(body.challenge_id)||!body.proof||Object.keys(body.proof).sort().join()!=='account_id,public_key,signature'||![body.proof.account_id,body.proof.public_key,body.proof.signature].every(v=>typeof v==='string'&&v.length<200)))return reply(400,{error:'Invalid wallet proof.'});
        if(path==='/npc'&&(!uuid(body.request_id)||Object.keys(body).sort().join()!==(body.message!==undefined?'message,request_id':'choice,request_id')))return reply(400,{error:'Invalid conversation.'});
        if(path==='/new-game' && (Object.keys(body).sort().join()!=='request_id,world_id'||!uuid(body.world_id)||!uuid(body.request_id)))return reply(400,{error:'Invalid new-game request.'});
        if(path==='/select-save' && (Object.keys(body).sort().join()!=='expected_active,target_id,world_id'||![body.world_id,body.target_id,body.expected_active].every(uuid)))return reply(400,{error:'Invalid saved-game selection.'});
        if (path === '/action') {
          if (!['action,request_id,world_id','action,request_id,signed_tx,world_id'].includes(Object.keys(body).sort().join()) || !uuid(body.world_id) || !uuid(body.request_id)||'signed_tx' in body&&(typeof body.signed_tx!=='string'||body.signed_tx.length>32768)) return reply(400, { error: 'Invalid action request.' });
          try { validateAction(body.action); } catch { return reply(400, { error: 'Unsupported action or parameters.' }); }
        }
      }
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } };
      const auth = createClient(config.url, config.publishableKey, options);
      const { data: { user }, error: authError } = await auth.auth.getUser(bearer.slice(7));
      if (authError || !user) return reply(401, { error: 'Sign-in could not be verified.' });
      if (user.is_anonymous || !user.email_confirmed_at) return reply(403, { error: 'Use a verified account.' });
      const db = createClient(config.url, config.secretKey, options);
      const session = await activeSession(db, bearer, user.id);
      if (!session) return reply(401, { error: 'This session has ended. Sign in again.' });
      if(['/wallet-challenge','/wallet-link'].includes(path)){
        if(!origin)return reply(403,{error:'The game’s exact origin is required.'});
        const context:Context={db,owner:user.id,session,world:{id:'',status:'pending',contract_id:null},player:'',fetcher};
        return reply(200,path==='/wallet-challenge'?await walletChallenge(context,body,origin):await linkWallet(context,body,origin));
      }
      const query = db.from('game_worlds').select('id,status,contract_id,is_active,ownership_mode').eq('user_id', user.id);
      const { data: world, error } = await (selected === null ? query.eq('is_active', true) : query.eq('id', selected)).maybeSingle();
      if(!world&&!error&&path==='/saves')return reply(200,{saves:[],limit:2,active_world_id:null});
      if (error || !world) return reply(409, { error: 'Finish account setup first.' });
      if(['/new-game','/select-save'].includes(path)&&body.world_id!==world.id)return reply(403,{error:'This request belongs to another world.'});
      if (path === '/action' && body.world_id !== world.id) return reply(403, { error: 'This action belongs to another world.' });
      if (path === '/action' && world.is_active !== true) return reply(409, { error: 'This shop is inactive. Refresh your account.' });
      if(['/saves','/new-game','/select-save'].includes(path)) {
        const {data:rows,error:savesError}=await db.from('game_worlds').select('id,status,contract_id,is_active,previous_world_id,ownership_mode').eq('user_id',user.id).order('created_at',{ascending:true}).limit(5);
        if(savesError||!rows)return reply(503,{error:'Your saves could not be read.'});
        if(path==='/saves') {
          const saves=[];
          for(const row of rows){let alchemist=null;if(row.status==='ready'&&row.contract_id)try{alchemist=await view(row.contract_id,'alchemist_view',{},fetcher);}catch{}saves.push({world_id:row.id,is_active:row.is_active,alchemist,status:row.status,player_owned:row.ownership_mode==='owned'});}
          return reply(200,{saves,limit:2,active_world_id:rows.find(r=>r.is_active)?.id});
        }
        if(path==='/new-game') {
          const previous=rows.find(r=>r.previous_world_id===world.id);
          if(previous)return reply(200,{world_id:previous.id});
          if(rows.length>=2)return reply(409,{error:'Both free testnet save slots are in use. Existing games are preserved.'});
          const id=await dbCall({db,owner:user.id,session,world,player:'',fetcher},'prepare_fresh_game_world',{p_owner:user.id,p_session:session,p_previous:world.id});
          return reply(200,{world_id:id});
        }
        if(!rows.some(r=>r.id===body.target_id&&r.status==='ready'))return reply(404,{error:'That save is not available to your account.'});
        if(rows.find(r=>r.is_active)?.id!==body.expected_active)return reply(409,{error:'Your active save changed. Open saved games again.'});
        const id=await dbCall({db,owner:user.id,session,world,player:'',fetcher},'activate_game_world',{p_owner:user.id,p_session:session,p_world:body.target_id,p_expected_active:body.expected_active});
        return reply(200,{world_id:id});
      }
      if(world.ownership_mode==='owned'){
        const context:Context={db,owner:user.id,session,world,player:'',fetcher};
        const wallet=await ownedWallet(context);context.player=wallet.account_id;context.namespace=wallet.namespace;
        if(path==='/provision'){
          if(config.arenaWasm&&!await provisionReferee(db,config.arenaWasm,fetcher))return reply(200,{ready:false,step:'free arena setup'});
          return reply(200,await provision(context,config.wasm));
        }
        if(path.startsWith('/actions/')){const op=await operation(context,path.slice(9));if(!op)return reply(404,{error:'No action with this ID in your world.'});await supportRefill(context,op);return reply(200,publicOperation(await reconcile(context,op)));}
        if(world.status!=='ready')return reply(409,{error:'Your testnet shop is still being prepared.'});
        if(path==='/state')return reply(200,await snapshot(context));
        if(path==='/device')return reply(200,await device(context));
        if(path==='/rpc')return reply(200,await playerQuery(context,body));
        if(path==='/npc')return reply(200,await npc(context,body,config.jevKey||''));
        if(path==='/action'){
          if(['serve_customer','market_tick','next_day'].includes(body.action.kind))return reply(200,publicOperation(await execute(context,body.request_id,body.action,()=>planAction(context,body.action))));
          if(typeof body.signed_tx!=='string')return reply(400,{error:'This game requires a player-signed transaction.'});
          return reply(200,await signedPlayerAction(context,body));
        }
        return reply(404,{error:'Unsupported player-owned route.'});
      }
      if(['/npc','/device','/rpc'].includes(path)||body?.signed_tx)return reply(409,{error:'Open a player-owned saved game for this feature. Existing shops are preserved.'});
      const { data: wallet, error: walletError } = await db.from('game_player_wallets').select('account_id,funded_at').eq('world_id', world.id).single();
      if (walletError || !wallet.funded_at) return reply(409, { error: 'Player funding is not confirmed yet.' });
      const context: Context = { db, owner: user.id, session, world, player: wallet.account_id, fetcher };
      if (path === '/provision') return reply(200, await provision(context, config.wasm));
      if (path.startsWith('/actions/')) {
        const op = await operation(context, path.slice(9));
        return op ? reply(200, publicOperation(await reconcile(context, op))) : reply(404, { error: 'No action with this ID in your world.' });
      }
      if (world.status !== 'ready') return reply(409, { error: 'Your testnet shop is still being prepared.' });
      if (path === '/state') return reply(200, await snapshot(context));
      const op = await execute(context, body.request_id, body.action, () => planAction(context, body.action));
      return reply(200, publicOperation(op));
    } catch (error) {
      if((error as {status?:number}).status===400)return reply(400,{error:(error as Error).message});
      if(path==='/npc')return reply(503,{error:'Mira could not confirm this message. Conversation choices remain available; an uncertain Jev call will not be repeated.'});
      const allowed = ['A previous action needs confirmation. Refresh the ledger.', 'Request ID belongs to another action.'];
      return reply(503, { error: error instanceof Error && allowed.includes(error.message) ? error.message : 'The testnet shop could not be confirmed. Refresh the ledger; saved inventory and pending transactions are preserved.' });
    }
  };
}
