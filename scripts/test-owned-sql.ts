import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import assert from 'node:assert/strict';

// Disposable local PostgreSQL only; Vault below is a test double, never a hosted encryption claim.
const container='copper-owned-sql';
const sql=(text:string)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-v','ON_ERROR_STOP=1','-At'],{input:text,encoding:'utf8'}).trim();
assert.equal(sql('select current_database()'),'postgres');
sql(`drop schema public cascade; create schema public; drop schema if exists auth cascade; drop schema if exists vault cascade;
do $$begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon;create role authenticated;create role service_role bypassrls;end if;end$$;
grant usage on schema public to anon,authenticated,service_role;
create schema auth;create table auth.users(id uuid primary key);create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create function auth.jwt() returns jsonb language sql as $$ select '{}'::jsonb $$;
grant usage on schema auth to authenticated,service_role;
create schema vault;create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text,name text,description text);
create view vault.decrypted_secrets as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(s text,n text,d text) returns uuid language plpgsql as $$declare i uuid;begin insert into vault.secrets(secret,name,description)values(s,n,d) returning id into i;return i;end$$;
grant usage on schema vault to service_role;grant select,insert on vault.secrets to service_role;grant select on vault.decrypted_secrets to service_role;
`);
for(const file of readdirSync('supabase/migrations').filter(s=>s.endsWith('.sql')).sort())sql(readFileSync('supabase/migrations/'+file,'utf8'));
sql(readFileSync('supabase/tests/owned_access.sql','utf8'));
console.log('Owned wallet/NPC database checks passed on PostgreSQL 17.');
