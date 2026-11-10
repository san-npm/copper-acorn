// Local PostgreSQL only. Install the pinned test tool as described in the verification note.
import EmbeddedPostgres from '../.local/pg-tool/node_modules/embedded-postgres/dist/index.js';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const directory=await mkdtemp(new URL('../.local/pg-check-',import.meta.url).pathname);
const reservation=createServer();
await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
const pg=new EmbeddedPostgres({databaseDir:directory,port,password:randomUUID(),persistent:false,
  autoRehydrateSymlinks:true,postgresFlags:['-h','127.0.0.1'],onLog:()=>{},onError:()=>{}});
const sql=path=>readFile(new URL('../'+path,import.meta.url),'utf8');
let started=false,client,other;
try {
  await pg.initialise();await pg.start();started=true;
  await pg.createDatabase('briarbridge_checks');
  client=pg.getPgClient('briarbridge_checks','127.0.0.1');await client.connect();
  await client.query(await sql('supabase/tests/bootstrap-local.sql'));
  for (const file of ['20261105100754_create_game_world_bindings','20261105113743_add_custodial_player_wallets','20261105122122_persist_testnet_shop'])
    await client.query(await sql('supabase/migrations/'+file+'.sql'));
  // Seed before the migration to check existing IDs, keys and signed records survive unchanged.
  const owner=randomUUID(),session=randomUUID(),old=randomUUID();
  await client.query('insert into auth.users(id) values($1)',[owner]);
  await client.query('insert into auth.sessions(id,user_id) values($1,$2)',[session,owner]);
  await client.query("insert into game_worlds(id,user_id,status,contract_id) values($1,$2,'ready','preserved.testnet')",[old,owner]);
  await client.query("insert into game_operations(world_id,request_id,action,status) values($1,'preserved-action','{\"kind\":\"gather\"}','confirmed')",[old]);
  await client.query("insert into game_runtime(world_id,secret_id) values($1,vault.create_secret('fictional-runtime-key'))",[old]);
  await client.query("insert into game_player_wallets(world_id,account_id,public_key,secret_id,funded_at) values($1,$2,$3,vault.create_secret('fictional-preserved-key'),now())",[old,'ca-'+old.replaceAll('-','')+'.testnet','ed25519:'+'6'.repeat(32)]);
  const preserved=await client.query('select row_to_json(g) world from game_worlds g where id=$1',[old]);
  const journal=await client.query('select * from game_operations');
  const runtime=await client.query('select * from game_runtime');
  const wallets=await client.query('select * from game_player_wallets');
  await client.query(await sql('supabase/migrations/20261106191615_prepare_fresh_shop.sql'));
  const changed=(await client.query('select row_to_json(g) world from game_worlds g where id=$1',[old])).rows[0].world;
  assert.equal(changed.is_active,true);assert.equal(changed.previous_world_id,null);
  delete changed.is_active;delete changed.previous_world_id;
  assert.deepEqual(changed,preserved.rows[0].world);
  assert.deepEqual((await client.query('select * from game_operations')).rows,journal.rows);
  assert.deepEqual((await client.query('select * from game_runtime')).rows,runtime.rows);
  assert.deepEqual((await client.query('select * from game_player_wallets')).rows,wallets.rows);
  console.log('PASS migration preserves existing world, runtime and journal');
  await client.query(await sql('supabase/tests/fresh_shop.sql'));
  await client.query(await sql('supabase/tests/game_persistence.sql'));
  await client.query(await sql('supabase/tests/world_access.sql'));
  console.log('PASS fresh setup, funding/pending/stale/session guards, return to old shop and RLS');
  other=pg.getPgClient('briarbridge_checks','127.0.0.1');await other.connect();
  await client.query('set role service_role');await other.query('set role service_role');
  const params=[owner,session,old];
  const prepared=await Promise.all([client,other].map(c=>c.query('select prepare_fresh_game_world($1,$2,$3) id',params)));
  const fresh=prepared[0].rows[0].id;
  assert.equal(fresh,prepared[1].rows[0].id);
  assert.equal((await client.query('select count(*) n from game_worlds where user_id=$1',[owner])).rows[0].n,'2');
  await client.query("update game_worlds set status='ready',contract_id='replacement.testnet' where id=$1",[fresh]);
  await client.query("insert into game_player_wallets(world_id,account_id,public_key,secret_id,funded_at) values($1,$2,$3,vault.create_secret('fictional-fresh-key'),now())",[fresh,'ca-'+fresh.replaceAll('-','')+'.testnet','ed25519:'+'5'.repeat(32)]);
  await client.query('begin');
  await client.query("select begin_game_operation($1,$2,'racing-action','{\"kind\":\"gather\"}')",[old,owner]);
  const otherPid=(await other.query('select pg_backend_pid() pid')).rows[0].pid;
  const activation=other.query('select activate_game_world($1,$2,$3,$4)',[owner,session,fresh,old]).then(()=>null,error=>error);
  let waiting=false;
  for(let attempt=0;attempt<50;attempt++) {
    waiting=(await client.query('select cardinality(pg_blocking_pids($1))>0 waiting',[otherPid])).rows[0].waiting;
    if(waiting)break;
    await new Promise(resolve=>setTimeout(resolve,10));
  }
  assert.equal(waiting,true,'Activation must wait for the in-flight action row lock');
  await client.query('commit');
  assert.equal((await activation)?.code,'55P03');
  assert.equal((await client.query('select is_active from game_worlds where id=$1',[old])).rows[0].is_active,true);
  await client.query("select finish_game_operation($1,'racing-action','failed','{}','fictional only')",[old]);
  await client.query('select activate_game_world($1,$2,$3,$4)',[owner,session,fresh,old]);
  await assert.rejects(client.query("select begin_game_operation($1,$2,'late-action','{\"kind\":\"gather\"}')",[old,owner]),{code:'42501'});
  console.log('PASS concurrent preparation is idempotent; action/switch race cannot bypass pending guard');
  const unsafe=await client.query("select proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in ('ensure_active_game_world','prepare_fresh_game_world','activate_game_world','guard_inactive_game_operation') and (prosecdef or not coalesce(proconfig @> array['search_path=\"\"'],false) or has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))");
  assert.equal(unsafe.rowCount,0);
  console.log('PASS setup RPCs use invoker security, empty search paths and service-only grants');
  await client.query('select ensure_active_game_world($1)',[owner]);
  await client.query('reset role');
  const thirdOwner=randomUUID();await client.query('insert into auth.users(id) values($1)',[thirdOwner]);
  await client.query('set role service_role');
  const third=(await client.query('select ensure_active_game_world($1) id',[thirdOwner])).rows[0].id;
  await assert.rejects(client.query('select register_game_wallet($1,$2,$3,$4)',[third,thirdOwner,'ed25519:'+'7'.repeat(32),'ed25519:'+'7'.repeat(64)]),/Development wallet capacity reached/);
  assert.deepEqual((await client.query('select * from game_player_wallets where world_id=$1',[old])).rows,wallets.rows);
  console.log('PASS original wallet remains unchanged and two-wallet funding cap remains enforced');
} finally {
  await client?.end();await other?.end();
  if(started)await pg.stop();
  await rm(directory,{recursive:true,force:true});
}
