create table public.game_runtime (
  world_id uuid primary key references public.game_worlds(id) on delete restrict,
  secret_id uuid not null unique references vault.secrets(id) on delete restrict,
  served_day bigint check (served_day >= 0)
);
create table public.game_operations (
  world_id uuid not null references public.game_worlds(id) on delete restrict,
  request_id text not null check (request_id ~ '^[a-zA-Z0-9-]{8,80}$'),
  action jsonb not null check (jsonb_typeof(action) = 'object'),
  status text not null default 'preparing' check (status in ('preparing','pending','confirmed','failed')),
  claim_id uuid not null default gen_random_uuid(),
  lease_until timestamptz not null default (now() + interval '90 seconds'),
  signed_tx text,
  tx_hash text,
  signer_id text,
  served_day bigint check (served_day >= 0),
  result jsonb not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  primary key(world_id,request_id),
  check (status <> 'pending' or (signed_tx is not null and tx_hash is not null and signer_id is not null)),
  check (signed_tx is null or length(signed_tx) <= 1000000)
);
create unique index game_one_inflight on public.game_operations(world_id) where status in ('preparing','pending');
alter table public.game_runtime enable row level security;
alter table public.game_operations enable row level security;
revoke all on public.game_runtime, public.game_operations from public, anon, authenticated;
grant select, insert, update on public.game_runtime, public.game_operations to service_role;

-- The backend needs only these three fields to reject revoked sessions before signing.
grant select(id,user_id,not_after) on auth.sessions to service_role;
create function public.game_session_active(p_owner uuid,p_session uuid) returns boolean
language sql stable security invoker set search_path='' as $$
  select exists(select 1 from auth.sessions s where s.id=p_session and s.user_id=p_owner
    and (s.not_after is null or s.not_after > now()));
$$;

create function public.ensure_game_runtime(p_world uuid,p_owner uuid,p_keys jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform 1 from public.game_worlds where id=p_world and user_id=p_owner for update;
  if not found then raise exception 'World unavailable' using errcode='42501'; end if;
  if not exists(select 1 from public.game_runtime where world_id=p_world) then
    if jsonb_typeof(p_keys) <> 'object' or (select count(*) from jsonb_object_keys(p_keys)) <> 6 then
      raise exception 'Invalid runtime keys';
    end if;
    if exists(select 1 from jsonb_each_text(p_keys) k where k.key not in ('owner','mira','rowan','bram','customer','treasury')
      or k.value !~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{64,88}$') then raise exception 'Invalid runtime keys'; end if;
    insert into public.game_runtime(world_id,secret_id) values(p_world,
      vault.create_secret(p_keys::text,'briarbridge/runtime/'||p_world::text,'Custodial testnet game role keys'));
  end if;
end $$;

create function public.game_signing_key(p_world uuid,p_owner uuid,p_session uuid,p_role text) returns text
language plpgsql security invoker set search_path='' as $$
declare secret text;
begin
  if not public.game_session_active(p_owner,p_session) or not exists(select 1 from public.game_worlds where id=p_world and user_id=p_owner) then
    raise exception 'Session unavailable' using errcode='42501';
  end if;
  if p_role='player' then
    select s.decrypted_secret into secret from public.game_player_wallets w join vault.decrypted_secrets s on s.id=w.secret_id where w.world_id=p_world;
  elsif p_role in ('owner','mira','rowan','bram','customer','treasury') then
    select s.decrypted_secret::jsonb ->> p_role into secret from public.game_runtime r join vault.decrypted_secrets s on s.id=r.secret_id where r.world_id=p_world;
  else raise exception 'Unknown role'; end if;
  if secret is null then raise exception 'Key unavailable'; end if;
  return secret;
end $$;

create function public.begin_game_operation(p_world uuid,p_owner uuid,p_request text,p_action jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare op public.game_operations;
begin
  perform 1 from public.game_worlds where id=p_world and user_id=p_owner for update;
  if not found then raise exception 'World unavailable' using errcode='42501'; end if;
  -- A stale worker cannot publish after its preparing lease is fenced off.
  update public.game_operations set status='failed', error='Preparation expired before a signed transaction was saved.'
    where world_id=p_world and status='preparing' and lease_until < now();
  select * into op from public.game_operations where world_id=p_world and request_id=p_request;
  if found then
    if op.action <> p_action then raise exception 'Request ID belongs to another action' using errcode='23505'; end if;
    return to_jsonb(op);
  end if;
  if exists(select 1 from public.game_operations where world_id=p_world and status in ('preparing','pending')) then
    raise exception 'A previous action needs confirmation' using errcode='55P03';
  end if;
  -- shortcut: 1000 durable actions per development world; review quotas before opening public access.
  if (select count(*) from public.game_operations where world_id=p_world) >= 1000 then raise exception 'Development action limit reached'; end if;
  insert into public.game_operations(world_id,request_id,action) values(p_world,p_request,p_action) returning * into op;
  return to_jsonb(op);
end $$;

create function public.save_game_transaction(p_world uuid,p_request text,p_claim uuid,p_signed text,p_hash text,p_signer text,p_day bigint) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.game_operations set signed_tx=p_signed, tx_hash=p_hash, signer_id=p_signer, served_day=p_day,status='pending'
    where world_id=p_world and request_id=p_request and claim_id=p_claim and status='preparing' and lease_until>now();
  return found;
end $$;

create function public.finish_game_operation(p_world uuid,p_request text,p_status text,p_result jsonb,p_error text) returns void
language plpgsql security invoker set search_path='' as $$
declare op public.game_operations;
begin
  if p_status not in ('confirmed','failed') then raise exception 'Invalid terminal status'; end if;
  select * into op from public.game_operations where world_id=p_world and request_id=p_request for update;
  if op.status in ('confirmed','failed') then return; end if;
  if op.status <> 'pending' and not (op.status='preparing' and p_status='failed') then raise exception 'Action not submitted'; end if;
  update public.game_operations set status=p_status,result=p_result,error=p_error where world_id=p_world and request_id=p_request;
  if p_status='confirmed' and op.served_day is not null then
    update public.game_runtime set served_day=op.served_day where world_id=p_world;
  end if;
end $$;

revoke all on function public.game_session_active(uuid,uuid) from public,anon,authenticated;
revoke all on function public.ensure_game_runtime(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.game_signing_key(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.begin_game_operation(uuid,uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_game_transaction(uuid,text,uuid,text,text,text,bigint) from public,anon,authenticated;
revoke all on function public.finish_game_operation(uuid,text,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.game_session_active(uuid,uuid),public.ensure_game_runtime(uuid,uuid,jsonb),
  public.game_signing_key(uuid,uuid,uuid,text),public.begin_game_operation(uuid,uuid,text,jsonb),
  public.save_game_transaction(uuid,text,uuid,text,text,text,bigint),public.finish_game_operation(uuid,text,text,jsonb,text) to service_role;

comment on table public.game_operations is 'Durable private signed transaction journal; token inventory lives on NEAR, never in client saves.';
