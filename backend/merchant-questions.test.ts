import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merchantExperiment, merchantQuestion, needForDay, potionDescriptions } from './merchant-questions.ts';
import { requestBody } from './jev.ts';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

test('recorded merchant evidence matches the exact nine approved question payloads',()=>{
  const evidence=JSON.parse(readFileSync(new URL('./fixtures/merchant-evidence.json',import.meta.url),'utf8'));
  assert.equal(evidence.source,'cached_jev'); assert.equal(evidence.cases.length,9);
  for(const [index,c] of evidence.cases.entries()) {
    const entry=merchantExperiment()[index];
    assert.equal(c.request_sha256,createHash('sha256').update(requestBody(entry.request)).digest('hex'));
    assert.equal(c.model,'jev-1.14.0');
    assert.equal(Object.values(c.probabilities).filter(p=>typeof p==='number' && p>0.7).length,1);
  }
});

test('merchant questions contain only fictional requests and game descriptions',()=>{
  const cases=merchantExperiment();assert.equal(cases.length,10);
  assert.equal(new Set(cases.map(c=>c.id)).size,10);
  for(const c of cases){
    const text=requestBody(c.request);assert.ok(Buffer.byteLength(text)<6_000);
    assert.deepEqual(Object.keys(c.request.questions),Object.keys(potionDescriptions));
    assert.deepEqual(Object.keys(c.request.state).sort(),['potions','request','setting']);
    assert.equal(c.request.model,'jev-latest');assert.ok(!text.includes('apikey_'));
  }
});
test('each merchant gets its own three requests and invalid dates fail before inference',()=>{
  for(const merchant of ['mira','rowan','bram'] as const){
    assert.equal(new Set([1,2,3].map(day=>needForDay(merchant,day).id)).size,3);
    assert.deepEqual(needForDay(merchant,1),needForDay(merchant,4));
    assert.equal(needForDay(merchant,2).merchant,merchant);
  }
  for(const day of [0,-1,NaN,1.5])assert.throws(()=>needForDay('mira',day));
  assert.throws(()=>merchantQuestion(''));assert.throws(()=>merchantQuestion('x'.repeat(1001)));
});
