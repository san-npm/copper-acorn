import { Buffer } from 'node:buffer';
import { createGameHandler } from './handler.ts';
import { contractBase64 } from './contract-wasm.ts';
import {arenaBase64} from '../_shared/arena-wasm.ts';
import { gameOrigins } from '../_shared/origins.ts';
function key(name: string, legacy: string) {
  const keys = Deno.env.get(name);
  return (keys ? JSON.parse(keys).default : null) || Deno.env.get(legacy) || '';
}
Deno.serve(createGameHandler({
  url: Deno.env.get('SUPABASE_URL') || '',
  publishableKey: key('SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY'),
  secretKey: key('SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY'),
  origins: gameOrigins(Deno.env.get('GAME_ALLOWED_ORIGINS')),
  wasm: Buffer.from(contractBase64, 'base64'),
  jevKey:Deno.env.get('TYPESAFE_API_KEY')||'',
  arenaWasm:Buffer.from(arenaBase64,'base64'),
}));
