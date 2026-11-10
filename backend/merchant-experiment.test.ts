import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('merchant experiment never exceeds ten calls or retries an uncertain batch', () => {
  for (const status of [200, 402]) {
    const dir = mkdtempSync(join(tmpdir(), 'merchant-budget-'));
    try {
      for (const name of ['backend', 'scripts']) mkdirSync(join(dir, name));
      for (const name of ['backend/jev.ts', 'backend/merchant-questions.ts', 'scripts/merchant-experiment.ts']) copyFileSync(new URL(`../${name}`, import.meta.url), join(dir, name));
      writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
      writeFileSync(join(dir, 'fake.mjs'), `import {appendFileSync} from 'node:fs'; globalThis.fetch=async()=>{appendFileSync('calls','1');return Response.json({model:'scripted-test',answers:Object.fromEntries(['healing_tonic','focus_draught','restoration_elixir'].map(k=>[k,{type:'noul',noul:0.01}])),usage:{input_tokens:1,output_tokens:1}},{status:${status}})};`);
      const run = () => spawnSync(process.execPath, ['--import', './fake.mjs', 'scripts/merchant-experiment.ts', '--run'], { cwd: dir, env: { ...process.env, TYPESAFE_API_KEY: 'test-only' }, encoding: 'utf8', timeout: 10_000 });
      assert.equal(run().status, status === 200 ? 0 : 1);
      assert.notEqual(run().status, 0);
      assert.equal(readFileSync(join(dir, 'calls'), 'utf8').length, status === 200 ? 10 : 1);
      assert.ok(!readFileSync(join(dir, '.local/merchant-experiment.json'), 'utf8').includes('test-only'));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
