import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const environment=JSON.parse(await readFile(new URL('../deploy/public-env.json',import.meta.url),'utf8'));
assert.match(environment.VITE_PUBLIC_SUPABASE_URL,/^https:\/\/[a-z0-9]+\.supabase\.co$/);
assert.match(environment.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,/^sb_publishable_[A-Za-z0-9_-]+$/);
assert.deepEqual(Object.keys(environment).sort(),['VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY','VITE_PUBLIC_SUPABASE_URL']);
const result=spawnSync('npm',['run','build','--','--mode','playtest'],{stdio:'inherit',env:{...process.env,...environment,VITE_PUBLIC_LOCAL_SANDBOX:'false',VITE_PUBLIC_PLAYER_OWNERSHIP:'true'}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
