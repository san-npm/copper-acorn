import test from 'node:test';
import assert from 'node:assert/strict';
import { gameOrigins, publishedOrigin, previousOrigins } from '../supabase/functions/_shared/origins.ts';
import { createSessionHandler } from '../supabase/functions/game-session/handler.ts';
import { createGameHandler } from '../supabase/functions/game-api/handler.ts';

test('both hosted handlers accept only the exact published origin and configured development origins', async () => {
  const config = { url: 'https://example.supabase.co', publishableKey: 'test-public', secretKey: 'test-server', origins: gameOrigins(), wasm: new Uint8Array() };
  for (const handler of [createSessionHandler(config), createGameHandler(config)]) {
    for (const [origin, expected] of [[publishedOrigin,204], ...previousOrigins.map(origin => [origin,204]), ...['http://127.0.0.1:5173','http://localhost:5173','http://127.0.0.1:5175','http://localhost:5175','http://127.0.0.1:5189'].map(origin => [origin,204]), ['http://127.0.0.1:5176',403], ['https://another-site.ipfs.aleph.sh',403], [publishedOrigin+'.attacker.invalid',403]]) {
      const response = await handler(new Request('https://example.supabase.co/functions/v1/game-api/state', { method:'OPTIONS', headers:{Origin:String(origin)} }));
      assert.equal(response.status, expected);
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), expected === 204 ? origin : null);
    }
  }
});

test('explicit configured origins supplement the published site without duplicate or blank entries', () => {
  const origins = gameOrigins('https://explicit.example, http://localhost:5173, ');
  assert.ok(origins.includes(publishedOrigin));assert.ok(origins.includes('https://explicit.example'));
  assert.equal(origins.filter(x=>x==='http://localhost:5173').length,1);assert.ok(!origins.includes(''));
});
