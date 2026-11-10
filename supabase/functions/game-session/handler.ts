import { createClient } from '@supabase/supabase-js';
import { playerWallet } from './wallet.ts';
import { activeSession } from '../_shared/session.ts';

type Config = { url: string; publishableKey: string; secretKey: string; origins: string[] };
const columns = 'id,network,status,contract_id,created_at,is_active,previous_world_id';

export function createSessionHandler(config: Config, fetcher: typeof fetch = fetch) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin');
    const headers: Record<string, string> = { 'Cache-Control': 'no-store', Vary: 'Origin' };
    const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
    if (origin && !config.origins.includes(origin)) return reply(403, { error: 'Origin is not allowed.' });
    if (origin) headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Headers'] = 'authorization,apikey,content-type,x-client-info';
    headers['Access-Control-Allow-Methods'] = 'GET,POST,OPTIONS';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (!['GET', 'POST'].includes(request.method)) return reply(405, { error: 'Use GET or POST.' });
    const bearer = request.headers.get('authorization');
    if (!bearer?.startsWith('Bearer ') || bearer.length < 16 || bearer.length > 8192) return reply(401, { error: 'Sign in first.' });
    if (!config.url || !config.publishableKey || !config.secretKey) return reply(503, { error: 'Account service is not configured.' });
    const params = new URL(request.url).searchParams, selected = params.get('world_id');
    if (params.getAll('world_id').length > 1 || selected !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(selected)) return reply(400, { error: 'Invalid shop selection.' });

    try {
      if (request.method === 'POST') {
        if (!request.headers.get('content-type')?.startsWith('application/json')) return reply(415, { error: 'Send an empty JSON object.' });
        if (Number(request.headers.get('content-length') || 0) > 1024) return reply(413, { error: 'Request is too large.' });
        // Read only a bounded body, even when Content-Length is omitted.
        const reader = request.body?.getReader();
        let body = '';
        let bytes = 0;
        if (reader) {
          const decoder = new TextDecoder('utf-8', { fatal: true });
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            bytes += value.byteLength;
            if (bytes > 1024) { await reader.cancel(); return reply(413, { error: 'Request is too large.' }); }
            body += decoder.decode(value, { stream: true });
          }
          body += decoder.decode();
        }
        let data;
        try { data = JSON.parse(body); } catch { return reply(400, { error: 'Send an empty JSON object.' }); }
        if (!data || Array.isArray(data) || typeof data !== 'object' || Object.keys(data).length) return reply(400, { error: 'Identity and world values are selected by the server.' });
      }
      const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fetcher } };
      const auth = createClient(config.url, config.publishableKey, options);
      const { data: { user }, error: authError } = await auth.auth.getUser(bearer.slice(7));
      if (authError) return reply(authError.status && authError.status < 500 ? 401 : 503, { error: 'Sign-in could not be verified.' });
      if (!user || user.is_anonymous || !user.email_confirmed_at) return reply(403, { error: 'Use a verified social or email account.' });

      const db = createClient(config.url, config.secretKey, options);
      if (!await activeSession(db, bearer, user.id)) return reply(401, { error: 'This session has ended. Sign in again.' });
      if (request.method === 'POST' && selected === null) {
        const { error } = await db.rpc('ensure_active_game_world', { p_owner: user.id });
        if (error) return reply(503, { error: 'Account setup could not be saved. Check again before retrying.' });
      }
      const query = db.from('game_worlds').select(columns).eq('user_id', user.id);
      const { data: world, error } = await (selected === null ? query.eq('is_active', true) : query.eq('id', selected)).maybeSingle();
      if (error) return reply(503, { error: 'Saved account could not be read.' });
      if (selected !== null && !world) return reply(404, { error: 'This shop is not available to your account.' });
      const wallet = world ? await playerWallet(db, world.id, user.id, request.method === 'POST', fetcher) : null;
      return reply(200, { world, wallet });
    } catch {
      return reply(503, { error: 'Account setup could not be confirmed. Existing keys and funding requests are preserved; check again before retrying.' });
    }
  };
}
