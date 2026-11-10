import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { evaluate, judgment, requestBody, type NoulRequest } from './jev.ts';

const fixture: NoulRequest = JSON.parse(readFileSync(new URL('./fixtures/jev-probe.json', import.meta.url), 'utf8'));
const valid = {
  model: 'jev-latest',
  answers: {
    scraped_hand: { type: 'noul', noul: 0.95 },
    locked_box: { type: 'noul', noul: 0.02 },
    unclear_need: { type: 'noul', noul: 0.5 },
  },
  usage: { input_tokens: 300, output_tokens: 12 },
};

test('fictional probe is small and produces three distinct judgments', async () => {
  let calls = 0;
  const result = await evaluate(fixture, 'test-only-key', async (url, init) => {
    calls++;
    assert.equal(url, 'https://api.typesafe.ai/v1/systemone');
    assert.equal(init?.redirect, 'error');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer test-only-key');
    assert.equal(init?.body, requestBody(fixture));
    assert.ok(!String(init?.body).includes('test-only-key'));
    assert.ok(new TextEncoder().encode(String(init?.body)).byteLength < 1_500);
    return Response.json(valid);
  });
  assert.equal(calls, 1);
  assert.deepEqual(Object.values(result.probabilities).map(judgment), ['suitable', 'unsuitable', 'uncertain']);
  assert.deepEqual(result.usage, valid.usage);
});

test('uncertainty includes both threshold boundaries', () => {
  for (const p of [0.3, 0.5, 0.7]) assert.equal(judgment(p), 'uncertain');
  assert.equal(judgment(0), 'unsuitable');
  assert.equal(judgment(1), 'suitable');
  for (const p of [-0.1, 1.1, NaN, Infinity]) assert.throws(() => judgment(p));
});

test('HTTP failures never become a negative judgment and never retry', async () => {
  for (const status of [401, 402, 429, 500]) {
    let calls = 0;
    await assert.rejects(evaluate(fixture, 'test-only-key', async () => {
      calls++;
      return new Response('Untrusted service error body', { status });
    }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});

test('network errors do not expose request credentials', async () => {
  await assert.rejects(evaluate(fixture, 'test-only-key', async () => {
    throw new Error('A simulated transport error containing test-only-key');
  }), error => error instanceof Error && !error.message.includes('test-only-key'));
});

test('missing answers, wrong answer types, and invalid usage fail closed', async () => {
  const variants = [
    { ...valid, answers: {} },
    { ...valid, answers: { ...valid.answers, scraped_hand: { type: 'choice', choice: 'yes' } } },
    { ...valid, answers: { ...valid.answers, scraped_hand: { type: 'noul', noul: 2 } } },
    { ...valid, usage: { input_tokens: -1, output_tokens: 12 } },
    { ...valid, model: '' },
  ];
  for (const value of variants) {
    await assert.rejects(evaluate(fixture, 'test-only-key', async () => Response.json(value)));
  }
});

test('non-JSON and oversized responses fail without using their content', async () => {
  await assert.rejects(evaluate(fixture, 'test-only-key', async () => new Response('not-json')), /invalid JSON/);
  await assert.rejects(evaluate(fixture, 'test-only-key', async () => new Response('x'.repeat(33_000))), /response limit/);
});

test('invalid or oversized payloads make no external request', async () => {
  const neverFetch: typeof fetch = async () => { throw new Error('Unexpected external request'); };
  await assert.rejects(evaluate(fixture, '', neverFetch), /key is required/);
  await assert.rejects(evaluate({ ...fixture, state: { text: 'x'.repeat(6_001) } }, 'test-only-key', neverFetch), /payload limit/);
  await assert.rejects(evaluate({ ...fixture, questions: {} }, 'test-only-key', neverFetch), /one to three/);
});
