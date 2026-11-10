import { Buffer } from 'node:buffer';
import type { SupabaseClient } from '@supabase/supabase-js';

// Call only after Auth verifies this exact bearer token and its user.
export async function activeSession(db: SupabaseClient, bearer: string, owner: string): Promise<string | null> {
  let claims;
  try { claims = JSON.parse(Buffer.from(bearer.slice(7).split('.')[1], 'base64url').toString('utf8')); }
  catch { return null; }
  if (!claims || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(claims.session_id)
    || claims.sub !== owner || !Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) return null;
  const { data, error } = await db.rpc('game_session_active', { p_owner: owner, p_session: claims.session_id });
  return !error && data === true ? claims.session_id : null;
}
