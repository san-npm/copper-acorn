import { createHash } from 'node:crypto';
import { mkdirSync, openSync, writeFileSync, closeSync } from 'node:fs';
import { evaluate, judgment, requestBody } from '../backend/jev.ts';
import { merchantExperiment, merchantNeeds } from '../backend/merchant-questions.ts';

const cases = merchantExperiment();
if (!process.argv.includes('--run')) {
  console.log(JSON.stringify({ requests: 0, maximum_requests: cases.length, cases }, null, 2));
} else {
  const key = process.env.TYPESAFE_API_KEY;
  if (!key?.trim()) throw new Error('Private TYPESAFE_API_KEY is required.');
  const folder = new URL('../.local/', import.meta.url);
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const receipt = new URL('merchant-experiment.json', folder);
  // Reserve the whole approved batch once; even a failed/uncertain attempt blocks another run.
  const marker = openSync(receipt, 'wx', 0o600);
  const record = { status: 'pending', requests: 0, maximum_requests: 10, cases: [] as object[] };
  writeFileSync(marker, JSON.stringify(record)); closeSync(marker);
  const save = () => writeFileSync(receipt, JSON.stringify(record, null, 2), { mode: 0o600 });
  try {
    for (const entry of cases) {
      record.requests++; save();
      const result = await evaluate(entry.request, key);
      const request_sha256 = createHash('sha256').update(requestBody(entry.request)).digest('hex');
      const completed_at = new Date().toISOString();
      record.cases.push({ ...entry, request_sha256, completed_at, result }); save();
      console.log(JSON.stringify({ id: entry.id, model: result.model, probabilities: result.probabilities, usage: result.usage }));
    }
    record.status = 'completed'; save();
    const evidence = record.cases.slice(0, 9).map((raw, index) => {
      const entry = raw as { completed_at: string; request_sha256: string; result: { model: string; probabilities: Record<string, number> } };
      const need = merchantNeeds[index];
      return { merchant: need.merchant, slot: index % 3, text: need.text, model: entry.result.model,
        recorded_at: entry.completed_at, request_sha256: entry.request_sha256, probabilities: entry.result.probabilities };
    });
    const holdout = record.cases[9] as { result: { probabilities: Record<string, number> } };
    if (Object.values(holdout.result.probabilities).some(p => judgment(p) !== 'unsuitable')) throw new Error('Negative holdout failed; evidence was not enabled.');
    writeFileSync(new URL('merchant-evidence.json', folder), JSON.stringify({ source: 'cached_jev', cases: evidence }, null, 2), { mode: 0o600 });
  } catch (error) {
    record.status = 'failed'; save();
    console.error(error instanceof Error ? error.message : 'Experiment failed.'); process.exitCode = 1;
  }
}
