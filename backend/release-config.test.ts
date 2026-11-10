import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../vite.config.ts';

test('authenticated playtest builds reject missing settings, server secrets and enabled Sandbox',()=>{
  const keys=['VITE_PUBLIC_SUPABASE_URL','VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY','VITE_PUBLIC_LOCAL_SANDBOX'],before=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  const build=()=>{assert.equal(typeof config,'function');return(config as Function)({command:'build',mode:'playtest'});};
  try{
    process.env.VITE_PUBLIC_SUPABASE_URL='https://example.supabase.co';process.env.VITE_PUBLIC_LOCAL_SANDBOX='false';
    process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY='';assert.throws(build,/require public Supabase/);
    process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_secret_not_a_browser_key';assert.throws(build,/require public Supabase/);
    const token=(role:string)=>['header',Buffer.from(JSON.stringify({role})).toString('base64url'),'signature'].join('.');
    process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY=token('service_role');assert.throws(build,/require public Supabase/);
    process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY=token('anon');assert.doesNotThrow(build);
    process.env.VITE_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_fictional_test_key';assert.doesNotThrow(build);
    process.env.VITE_PUBLIC_LOCAL_SANDBOX='true';assert.throws(build,/Sandbox explicitly disabled/);
  }finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
