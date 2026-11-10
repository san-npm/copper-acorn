import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import assert from 'node:assert/strict';

const art=JSON.parse(await readFile(new URL('../deploy/playtest-art.json',import.meta.url),'utf8'));
const environment=JSON.parse(await readFile(new URL('../deploy/public-env.json',import.meta.url),'utf8'));
assert.match(art.origin,/^https:\/\/bafy[a-z0-9]+\.ipfs\.aleph\.sh\/$/);
assert.match(environment.VITE_PUBLIC_SUPABASE_URL,/^https:\/\/[a-z0-9]+\.supabase\.co$/);
assert.match(environment.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,/^sb_publishable_[A-Za-z0-9_-]+$/);
assert.deepEqual(Object.keys(environment).sort(),['VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY','VITE_PUBLIC_SUPABASE_URL']);
const entries=Object.entries(art.files) as [string,string][];
assert.ok(entries.length>0&&entries.length<100);
let next=0;
await Promise.all(Array.from({length:6},async()=>{
  while(next<entries.length){
    const [path,hash]=entries[next++];
    assert.match(path,/^assets\/(?:(?:characters|actions)\/[a-z-]+\.(?:png|json)|market\/(?:mira|rowan|bram)\.png)$/);
    assert.match(hash,/^[a-f0-9]{64}$/);
    const destination=resolve('.local/mana-review',path.startsWith('assets/market/')?path.split('/').pop()!:path);
    let bytes:Uint8Array|undefined;
    try{const cached=await readFile(destination);if(createHash('sha256').update(cached).digest('hex')===hash)bytes=cached;}catch{}
    if(!bytes){
      const response=await fetch(new URL(path,art.origin),{redirect:'error',signal:AbortSignal.timeout(30_000)});
      if(!response.ok)throw Error('Artwork download failed: '+path+' ('+response.status+')');
      bytes=new Uint8Array(await response.arrayBuffer());
      assert.ok(bytes.length<1_000_000,'Unexpected artwork size: '+path);
      assert.equal(createHash('sha256').update(bytes).digest('hex'),hash,'Artwork hash mismatch: '+path);
      await mkdir(dirname(destination),{recursive:true});await writeFile(destination,bytes);
    }
  }
}));
console.log('Verified '+entries.length+' playtest artwork files; original source packs are excluded.');
if(!process.argv.includes('--assets-only')){
  const result=spawnSync('npm',['run','build','--','--mode','playtest'],{stdio:'inherit',env:{...process.env,...environment,VITE_PUBLIC_LOCAL_ART:'true',VITE_PUBLIC_LOCAL_SANDBOX:'false',VITE_PUBLIC_PLAYER_OWNERSHIP:'true'}});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
