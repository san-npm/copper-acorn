import {mkdirSync,openSync,writeFileSync,closeSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluate,requestBody,type NoulRequest} from '../backend/jev.ts';

const cases:NoulRequest[]=JSON.parse(readFileSync(new URL('../backend/fixtures/npc-probe.json',import.meta.url),'utf8')).requests;
if(cases.length!==3||cases.some(r=>Buffer.byteLength(requestBody(r))>1500))throw Error('Probe exceeds its reviewed payload size.');
if(!process.argv.includes('--run'))console.log(JSON.stringify({mode:'preview',maximum_requests:3,total_input_token_budget:4000,bytes:cases.map(r=>Buffer.byteLength(requestBody(r))),cases},null,2));
else {
  const key=process.env.TYPESAFE_API_KEY;if(!key)throw Error('Load the existing private TypeSafe environment file.');
  const folder=new URL('../.local/',import.meta.url),file=new URL('npc-probe.json',folder);
  mkdirSync(folder,{recursive:true,mode:0o700});
  const record={source:'live_jev_probe',status:'pending',maximum_requests:3,input_token_budget:4000,requests:0,input_tokens:0,cases:[] as object[]};
  const marker=openSync(file,'wx',0o600);writeFileSync(marker,JSON.stringify(record));closeSync(marker);
  const save=()=>writeFileSync(file,JSON.stringify(record,null,2),{mode:0o600});
  try{
    for(const request of cases){
      // Bytes plus reserve is a conservative preflight; account usage also gates every subsequent call.
      if(record.input_tokens+Buffer.byteLength(requestBody(request))+512>4000){record.status='budget_stopped';break;}
      record.requests++;save();
      const result=await evaluate(request,key);
      record.input_tokens+=result.usage.input_tokens;
      record.cases.push({request,request_sha256:createHash('sha256').update(requestBody(request)).digest('hex'),completed_at:new Date().toISOString(),result});save();
      console.log(JSON.stringify({request:record.requests,model:result.model,usage:result.usage,probabilities:result.probabilities}));
      if(record.input_tokens>4000)throw Error('Provider-reported input usage exceeded the budget; no further requests will run.');
    }
    if(record.status==='pending')record.status='completed';save();
  }catch(e){record.status='failed';save();console.error(e instanceof Error?e.message:'Jev probe failed.');process.exitCode=1;}
}
