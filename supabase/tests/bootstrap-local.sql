-- Test-only stand-ins for Supabase Auth/Vault. No real secrets or encryption are tested here.
do $$ begin
  if current_database() <> 'briarbridge_checks' then raise exception 'Isolated test database required'; end if;
end $$;
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users(id uuid primary key,aud text,role text,is_anonymous boolean default false);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),not_after timestamptz);
create function auth.uid() returns uuid language sql stable as $$
  select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
$$;
create function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}');
$$;
grant usage on schema auth to anon,authenticated,service_role;
create schema vault;
create table vault.secrets(id uuid primary key default gen_random_uuid(),secret text not null);
create view vault.decrypted_secrets with (security_invoker=true) as select id,secret as decrypted_secret from vault.secrets;
create function vault.create_secret(secret text,name text default null,description text default null) returns uuid
language sql security invoker set search_path='' as $$
  insert into vault.secrets(secret) values(secret) returning id;
$$;
grant usage on schema vault to service_role;
grant select,insert on vault.secrets to service_role;
grant select on vault.decrypted_secrets to service_role;
revoke all on function vault.create_secret(text,text,text) from public;
grant execute on function vault.create_secret(text,text,text) to service_role;
