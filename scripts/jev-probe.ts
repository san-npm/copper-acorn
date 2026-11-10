import { createHash } from 'node:crypto';
import { mkdirSync, openSync, readFileSync, writeFileSync, closeSync } from 'node:fs';
import { evaluate, judgment, requestBody, type NoulRequest } from '../backend/jev.ts';

const request: NoulRequest = JSON.parse(readFileSync(new URL('../backend/fixtures/jev-probe.json', import.meta.url), 'utf8'));
const body = requestBody(request);
const bytes = Buffer.byteLength(body);
if (bytes > 1_500) throw new Error('Probe payload exceeds its reviewed size limit.');

if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ mode: 'preview', requests: 0, bytes, request }, null, 2));
} else {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key?.trim()) throw new Error('Set TYPESAFE_API_KEY through the private environment file.');
  const folder = new URL('../.local/', import.meta.url);
  const receipt = new URL('jev-probe.json', folder);
  mkdirSync(folder, { mode: 0o700, recursive: true });
  const record = {
    started_at: new Date().toISOString(),
    request_sha256: createHash('sha256').update(body).digest('hex'),
    requests: 1,
    request,
  };
  // An existing marker blocks repeat spend, including retries after an uncertain network outcome.
  const marker = openSync(receipt, 'wx', 0o600);
  writeFileSync(marker, JSON.stringify({ ...record, status: 'pending' }, null, 2));
  closeSync(marker);
  try {
    const result = await evaluate(request, key);
    const decisions = Object.fromEntries(Object.entries(result.probabilities).map(([name, p]) => [name, judgment(p)]));
    writeFileSync(receipt, JSON.stringify({ ...record, status: 'completed', completed_at: new Date().toISOString(), result, decisions }, null, 2));
    console.log(JSON.stringify({ mode: 'live', model: result.model, usage: result.usage, probabilities: result.probabilities, decisions }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Jev probe failed.';
    writeFileSync(receipt, JSON.stringify({ ...record, status: 'failed', error: message }, null, 2));
    console.error(message);
    process.exitCode = 1;
  }
}
