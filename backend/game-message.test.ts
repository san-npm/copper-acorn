import {test} from 'node:test';
import assert from 'node:assert/strict';
import {gameMessage} from '../web/src/game-message.ts';

test('game feedback preserves rules and replaces service diagnostics', () => {
  for (const message of ['Not enough Copper.', 'Target is out of range.', 'Your last request is kept for a safe retry.', 'Moonmint needs another day to grow.']) assert.equal(gameMessage(message), message);
  for (const message of [undefined, '', 'NEAR testnet unavailable', 'Jev limit reached', 'Renew your wallet key', 'Invalid transaction nonce', 'Supabase rejected token', 'On-chain settlement failed', 'RPC failure at https://example.com', 'ed25519:secret', 'a'.repeat(64)]) assert.equal(gameMessage(message, 'Please try again.'), 'Please try again.');
});
