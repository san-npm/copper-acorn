import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';

const environment=JSON.parse(await readFile(new URL('../deploy/public-env.json',import.meta.url),'utf8'));
assert.match(environment.VITE_PUBLIC_SUPABASE_URL,/^https:\/\/[a-z0-9]+\.supabase\.co$/);
assert.match(environment.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY,/^sb_publishable_[A-Za-z0-9_-]+$/);
const required=['VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY','VITE_PUBLIC_SUPABASE_URL'],social=['VITE_PUBLIC_PRIVY_APP_ID','VITE_PUBLIC_PRIVY_CLIENT_ID'];
assert.ok(Object.keys(environment).every(k=>[...required,...social].includes(k)));
for(const name of social)if(environment[name])assert.match(environment[name],/^[A-Za-z0-9_-]{8,100}$/);
if(environment.VITE_PUBLIC_PRIVY_CLIENT_ID)assert.ok(environment.VITE_PUBLIC_PRIVY_APP_ID);
const result=spawnSync('npm',['run','build','--','--mode','playtest'],{stdio:'inherit',env:{...process.env,...environment,VITE_PUBLIC_LOCAL_SANDBOX:'false',VITE_PUBLIC_PLAYER_OWNERSHIP:'true'}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status||1);
