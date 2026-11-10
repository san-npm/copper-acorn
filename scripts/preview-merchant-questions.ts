import { mkdir, writeFile } from 'node:fs/promises';
import { merchantExperiment } from '../backend/merchant-questions.ts';
import { requestBody } from '../backend/jev.ts';

const cases=merchantExperiment();
await mkdir('.local',{recursive:true});
await writeFile('.local/merchant-questions-preview.json',JSON.stringify({ inference_requests_sent:0,maximum_proposed_requests:10,cases },null,2)+'\n');
console.log(JSON.stringify({inference_requests_sent:0,cases:cases.length,questions_per_request:3,maximum_request_bytes:Math.max(...cases.map(c=>Buffer.byteLength(requestBody(c.request)))),preview:'.local/merchant-questions-preview.json'}));
