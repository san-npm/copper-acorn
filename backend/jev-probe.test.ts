import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('isolated probe records one simulated attempt and blocks repeats after success or failure', () => {
  for (const status of [200, 402]) {
    const folder = mkdtempSync(join(tmpdir(), 'alchemy-jev-probe-'));
    try {
      for (const dir of ['backend/fixtures', 'scripts']) mkdirSync(join(folder, dir), { recursive: true });
      for (const name of ['backend/jev.ts', 'backend/fixtures/jev-probe.json', 'scripts/jev-probe.ts']) {
        copyFileSync(new URL(`../${name}`, import.meta.url), join(folder, name));
      }
      writeFileSync(join(folder, 'package.json'), '{"type":"module"}');
      // Replace fetch before loading the script: no external request can be made by this test.
      writeFileSync(join(folder, 'fake-api.mjs'), `
        import { appendFileSync } from 'node:fs';
        globalThis.fetch = async () => {
          appendFileSync('calls.txt', 'called\\n');
          return Response.json({
            model:'simulated-test-model',
            answers:{scraped_hand:{type:'noul',noul:0.95},locked_box:{type:'noul',noul:0.02},unclear_need:{type:'noul',noul:0.5}},
            usage:{input_tokens:300,output_tokens:12}
          },{status:${status}});
        };
      `);
      const run = () => spawnSync(process.execPath, ['--import', './fake-api.mjs', './scripts/jev-probe.ts', '--run'], {
        cwd: folder,
        env: { ...process.env, TYPESAFE_API_KEY: 'test-only-key' },
        encoding: 'utf8',
        timeout: 10_000,
      });
      const first = run();
      assert.equal(first.status, status === 200 ? 0 : 1, first.stderr);
      const record = JSON.parse(readFileSync(join(folder, '.local/jev-probe.json'), 'utf8'));
      assert.equal(record.status, status === 200 ? 'completed' : 'failed');
      assert.equal(record.requests, 1);
      assert.equal(statSync(join(folder, '.local/jev-probe.json')).mode & 0o777, 0o600);
      assert.ok(!JSON.stringify(record).includes('test-only-key'));
      assert.notEqual(run().status, 0);
      assert.equal(readFileSync(join(folder, 'calls.txt'), 'utf8'), 'called\n');
    } finally {
      rmSync(folder, { recursive: true, force: true });
    }
  }
});
