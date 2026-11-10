import {createArenaHandler} from './handler.ts';
import {gameOrigins} from '../_shared/origins.ts';
function key(name:string,legacy:string){const keys=Deno.env.get(name);return(keys?JSON.parse(keys).default:null)||Deno.env.get(legacy)||'';}
Deno.serve(createArenaHandler({url:Deno.env.get('SUPABASE_URL')||'',publishableKey:key('SUPABASE_PUBLISHABLE_KEYS','SUPABASE_ANON_KEY'),secretKey:key('SUPABASE_SECRET_KEYS','SUPABASE_SERVICE_ROLE_KEY'),origins:gameOrigins(Deno.env.get('GAME_ALLOWED_ORIGINS')),background:task=>(globalThis as typeof globalThis&{EdgeRuntime?:{waitUntil:(p:Promise<void>)=>void}}).EdgeRuntime?.waitUntil(task)}));
