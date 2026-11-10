begin;

alter table public.game_worlds add column ownership_mode text not null default 'legacy'
  check(ownership_mode in ('legacy','owned'));
create unique index game_world_owner on public.game_worlds(id,user_id);

create table public.game_wallet_challenges (
  id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),
  session_id uuid not null,request_id uuid not null,world_id uuid references public.game_worlds(id),
  origin text not null check(length(origin)<=300),nonce text not null check(length(nonce)=44),
  expires_at timestamptz not null default now()+interval '5 minutes',used_at timestamptz,
  account_id text,public_key text,proof_hash text,unique(user_id,request_id)
);
create table public.game_owned_wallets (
  world_id uuid primary key,user_id uuid not null,account_id text not null check(length(account_id)<=64 and
    (account_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*[.]testnet$' or account_id ~ '^[a-f0-9]{64}$')),
  public_key text not null check(public_key ~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  namespace text not null unique,verified_at timestamptz not null default now(),
  faucet_requested_at timestamptz,faucet_http_status integer,funded_at timestamptz,
  foreign key(world_id,user_id) references public.game_worlds(id,user_id) on delete restrict
);
create index owned_wallet_owner on public.game_owned_wallets(user_id,world_id);

create table public.game_npc_threads (
  world_id uuid not null,user_id uuid not null,npc text not null check(npc='mira'),
  thread jsonb not null default '{"messages":[],"turn":0}' check(octet_length(thread::text)<=16384),
  primary key(world_id,npc),foreign key(world_id,user_id) references public.game_worlds(id,user_id)
);
create table public.game_npc_turns (
  world_id uuid not null,npc text not null default 'mira',request_id uuid not null,
  input_hash text not null check(length(input_hash)=64),status text not null default 'working' check(status in ('working','done','uncertain')),
  claim_id uuid not null default gen_random_uuid(),lease_until timestamptz not null default now()+interval '90 seconds',
  result jsonb,error text,created_at timestamptz not null default now(),primary key(world_id,npc,request_id),
  foreign key(world_id,npc) references public.game_npc_threads(world_id,npc)
);
create unique index npc_one_inflight on public.game_npc_turns(world_id,npc) where status='working';
create table public.game_npc_budget (
  singleton boolean primary key default true check(singleton),request_limit integer not null default 0 check(request_limit between 0 and 20),
  token_limit integer not null default 0 check(token_limit between 0 and 60000),
  requests_used integer not null default 0 check(requests_used>=0),tokens_used integer not null default 0 check(tokens_used>=0),
  tokens_reserved integer not null default 0 check(tokens_reserved>=0)
);
insert into public.game_npc_budget(singleton) values(true);
create function public.no_new_custodial_wallet() returns trigger language plpgsql security invoker set search_path='' as $$
begin raise exception 'New games require a player-owned wallet; existing shops are preserved' using errcode='42501';end$$;
create trigger game_wallet_ownership before insert on public.game_player_wallets for each row execute function public.no_new_custodial_wallet();
revoke all on function public.no_new_custodial_wallet() from public,anon,authenticated;
create table public.game_npc_judgments (
  world_id uuid not null,request_id uuid not null,input_hash text not null,
  claim_id uuid not null default gen_random_uuid(),result jsonb,created_at timestamptz not null default now(),
  primary key(world_id,request_id),foreign key(world_id) references public.game_worlds(id)
);
create table public.game_gas_grants (
  account_id text not null,grant_day date not null default current_date,world_id uuid not null references public.game_worlds(id),
  request_id uuid not null,signed_tx text not null check(length(signed_tx)<=32768),tx_hash text not null,primary key(account_id,grant_day)
);
create table public.game_arena_runtime (
  singleton boolean primary key default true check(singleton),account_id text not null unique,
  secret_id uuid not null references vault.secrets(id),contract_id text not null,
  faucet_requested_at timestamptz,faucet_http_status integer,ready_at timestamptz,signed_tx text,tx_hash text
);
create table public.game_duel_outbox (
  match_id uuid primary key,report jsonb not null check(octet_length(report::text)<8192),
  status text not null default 'pending' check(status in ('pending','confirmed','conflict')),
  attempts integer not null default 0 check(attempts between 0 and 5),lease_until timestamptz not null default now(),
  claim_id uuid not null default gen_random_uuid(),signed_tx text,tx_hash text,error text,created_at timestamptz not null default now()
);

do $$declare t text;begin
  foreach t in array array['game_wallet_challenges','game_owned_wallets','game_npc_threads','game_npc_turns',
    'game_npc_budget','game_npc_judgments','game_gas_grants','game_arena_runtime','game_duel_outbox'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select,insert,update on public.%I to service_role',t);
  end loop;
end $$;

create function public.begin_wallet_challenge(p_owner uuid,p_session uuid,p_request uuid,p_world uuid,p_origin text,p_nonce text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.game_wallet_challenges;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,49110413));
  select * into c from public.game_wallet_challenges where user_id=p_owner and request_id=p_request;
  if found then
    if c.session_id<>p_session or c.origin<>p_origin or c.world_id is distinct from p_world then raise exception 'Challenge request changed'; end if;
    return to_jsonb(c);
  end if;
  if p_world is not null and not exists(select 1 from public.game_worlds where id=p_world and user_id=p_owner)
    then raise exception 'Shop unavailable' using errcode='42501'; end if;
  if (select count(*) from public.game_wallet_challenges where user_id=p_owner and expires_at>now())>=20 then raise exception 'Wallet challenge limit reached'; end if;
  insert into public.game_wallet_challenges(user_id,session_id,request_id,world_id,origin,nonce)
    values(p_owner,p_session,p_request,p_world,p_origin,p_nonce) returning * into c;
  return to_jsonb(c);
end $$;

create function public.bind_owned_wallet(p_owner uuid,p_session uuid,p_challenge uuid,p_account text,p_key text,p_proof text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare c public.game_wallet_challenges; target uuid;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('owned-wallet-allocation',49110413));
  select * into c from public.game_wallet_challenges where id=p_challenge and user_id=p_owner and session_id=p_session for update;
  if not found then raise exception 'Challenge unavailable' using errcode='42501'; end if;
  if c.used_at is not null then
    if c.account_id<>p_account or c.public_key<>p_key or c.proof_hash<>p_proof then raise exception 'Wallet proof changed'; end if;
    return c.world_id;
  end if;
  if c.expires_at<=now() or p_proof !~ '^[a-f0-9]{64}$' then raise exception 'Wallet challenge expired'; end if;
  if c.world_id is not null and exists(select 1 from public.game_owned_wallets where world_id=c.world_id) then
    if not exists(select 1 from public.game_owned_wallets where world_id=c.world_id and account_id=p_account)
      then raise exception 'This shop belongs to another wallet'; end if;
    target=c.world_id;
    update public.game_owned_wallets set public_key=p_key,verified_at=now() where world_id=target;
  else
    if (select count(*) from public.game_owned_wallets where user_id=p_owner)>=2 then raise exception 'Both player-owned save slots are in use'; end if;
    if (select count(*) from public.game_owned_wallets)+(select count(*) from public.game_player_wallets)>=10 then raise exception 'Free playtest allocation is full'; end if;
    insert into public.game_worlds(user_id,is_active,ownership_mode) values(p_owner,
      not exists(select 1 from public.game_worlds where user_id=p_owner and is_active),'owned') returning id into target;
    insert into public.game_owned_wallets(world_id,user_id,account_id,public_key,namespace)
      values(target,p_owner,p_account,p_key,'ao-'||replace(target::text,'-','')||'.testnet');
  end if;
  update public.game_wallet_challenges set world_id=target,used_at=now(),account_id=p_account,public_key=p_key,proof_hash=p_proof where id=p_challenge;
  return target;
end $$;

create function public.claim_owned_faucet(p_owner uuid,p_session uuid,p_world uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  update public.game_owned_wallets set faucet_requested_at=now() where world_id=p_world and user_id=p_owner and faucet_requested_at is null;
  return found;
end $$;

create function public.begin_npc_turn(p_owner uuid,p_session uuid,p_world uuid,p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare turn public.game_npc_turns;
begin
  if not public.game_session_active(p_owner,p_session) or not exists(select 1 from public.game_worlds where id=p_world and user_id=p_owner and is_active and status='ready') then raise exception 'Active shop unavailable' using errcode='42501'; end if;
  insert into public.game_npc_threads(world_id,user_id,npc) values(p_world,p_owner,'mira') on conflict do nothing;
  perform 1 from public.game_npc_threads where world_id=p_world and npc='mira' for update;
  select * into turn from public.game_npc_turns where world_id=p_world and npc='mira' and request_id=p_request;
  if found then
    if turn.input_hash<>p_hash then raise exception 'Message request changed'; end if;
    if turn.status='uncertain' or turn.status='working' and turn.lease_until<now() then
      update public.game_npc_turns set status='working',claim_id=gen_random_uuid(),lease_until=now()+interval '90 seconds'
        where world_id=p_world and npc='mira' and request_id=p_request returning * into turn;
      return to_jsonb(turn)||jsonb_build_object('claimed',true);
    end if;
    return to_jsonb(turn)||jsonb_build_object('claimed',false);
  end if;
  update public.game_npc_turns set status='uncertain',error='Earlier message needs a new conversation choice.' where world_id=p_world and npc='mira' and status='working' and lease_until<now();
  if exists(select 1 from public.game_npc_turns where world_id=p_world and npc='mira' and status='working') then raise exception 'Mira is finishing the previous message' using errcode='55P03'; end if;
  if (select count(*) from public.game_npc_turns where world_id=p_world)>=128 then raise exception 'Conversation playtest quota reached'; end if;
  insert into public.game_npc_turns(world_id,request_id,input_hash) values(p_world,p_request,p_hash) returning * into turn;
  return to_jsonb(turn)||jsonb_build_object('claimed',true);
end $$;

create function public.finish_npc_turn(p_owner uuid,p_session uuid,p_world uuid,p_request uuid,p_claim uuid,p_thread jsonb,p_result jsonb,p_error text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform 1 from public.game_npc_threads where world_id=p_world and user_id=p_owner and npc='mira' for update;
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  update public.game_npc_turns set status=case when p_error is null then 'done' else 'uncertain' end,result=p_result,error=p_error,
    lease_until=case when p_error is null then lease_until else now() end
    where world_id=p_world and request_id=p_request and claim_id=p_claim and status='working' and lease_until>now();
  if not found then return false; end if;
  if p_error is null then
    if jsonb_typeof(p_thread->'messages') is distinct from 'array' or jsonb_array_length(p_thread->'messages')>12 or octet_length(p_thread::text)>16384 then raise exception 'Invalid conversation'; end if;
    update public.game_npc_threads set thread=p_thread where world_id=p_world and npc='mira';
  end if;
  return true;
end $$;

create function public.reserve_npc_judgment(p_owner uuid,p_session uuid,p_world uuid,p_request uuid,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare j public.game_npc_judgments; b public.game_npc_budget;
begin
  if not public.game_session_active(p_owner,p_session) or not exists(select 1 from public.game_worlds where id=p_world and user_id=p_owner and is_active and status='ready') then raise exception 'Active shop unavailable' using errcode='42501'; end if;
  select * into b from public.game_npc_budget where singleton for update;
  select * into j from public.game_npc_judgments where world_id=p_world and request_id=p_request;
  if found then
    if j.input_hash<>p_hash then raise exception 'Judgment request changed'; end if;
    return to_jsonb(j)||jsonb_build_object('claimed',false);
  end if;
  if b.requests_used>=b.request_limit or b.tokens_used+b.tokens_reserved+3000>b.token_limit then raise exception 'Jev playtest allowance exhausted'; end if;
  insert into public.game_npc_judgments(world_id,request_id,input_hash) values(p_world,p_request,p_hash) returning * into j;
  update public.game_npc_budget set requests_used=requests_used+1,tokens_reserved=tokens_reserved+3000 where singleton;
  return to_jsonb(j)||jsonb_build_object('claimed',true);
end $$;

create function public.finish_npc_judgment(p_world uuid,p_request uuid,p_claim uuid,p_result jsonb) returns boolean
language plpgsql security invoker set search_path='' as $$
declare used integer;
begin
  used=(p_result->'usage'->>'input_tokens')::integer;
  if used is null or used<0 or octet_length(p_result::text)>16384 then raise exception 'Invalid judgment usage'; end if;
  perform 1 from public.game_npc_budget where singleton for update;
  update public.game_npc_judgments set result=p_result where world_id=p_world and request_id=p_request and claim_id=p_claim and result is null;
  if not found then return false; end if;
  update public.game_npc_budget set tokens_reserved=tokens_reserved-3000,tokens_used=tokens_used+used,
    request_limit=case when used>3000 then requests_used else request_limit end where singleton;
  return true;
end $$;

create function public.save_owned_gas_grant(p_owner uuid,p_session uuid,p_world uuid,p_request uuid,p_signed text,p_hash text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a text;g public.game_gas_grants;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501';end if;
  select account_id into a from public.game_owned_wallets where world_id=p_world and user_id=p_owner;
  if a is null or not exists(select 1 from public.game_operations where world_id=p_world and request_id=p_request::text and status='pending' and action->>'kind' in ('refill','rescue')) then raise exception 'Signed refill unavailable' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(a,49110414));
  insert into public.game_gas_grants(account_id,world_id,request_id,signed_tx,tx_hash) values(a,p_world,p_request,p_signed,p_hash) on conflict do nothing;
  select * into g from public.game_gas_grants where account_id=a and grant_day=current_date;
  if g.world_id<>p_world or g.request_id<>p_request then raise exception 'Today’s emergency gas support was already used';end if;
  return to_jsonb(g);
end $$;

create or replace function public.activate_game_world(p_owner uuid,p_session uuid,p_world uuid,p_expected_active uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare current_id uuid;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501';end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,48281741906002));
  perform 1 from public.game_worlds where user_id=p_owner order by id for update;
  select id into current_id from public.game_worlds where user_id=p_owner and is_active;
  if not exists(select 1 from public.game_worlds g where g.id=p_world and g.user_id=p_owner and g.status='ready' and (
    exists(select 1 from public.game_player_wallets where world_id=g.id and funded_at is not null) or
    exists(select 1 from public.game_owned_wallets where world_id=g.id and funded_at is not null))) then raise exception 'Target shop is not ready and funded';end if;
  if current_id=p_world then return p_world;end if;
  if current_id is distinct from p_expected_active then raise exception 'Active shop changed' using errcode='40001';end if;
  if exists(select 1 from public.game_operations where world_id in(current_id,p_world) and status in('preparing','pending')) then raise exception 'A previous action needs confirmation' using errcode='55P03';end if;
  update public.game_worlds set is_active=false where id=current_id;
  update public.game_worlds set is_active=true where id=p_world;
  return p_world;
end $$;

revoke all on function public.save_owned_gas_grant(uuid,uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.save_owned_gas_grant(uuid,uuid,uuid,uuid,text,text) to service_role;

create function public.ensure_arena_runtime(p_account text,p_secret text) returns void
language plpgsql security invoker set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(49110415);
  if not exists(select 1 from public.game_arena_runtime) then
    if p_account !~ '^ar-[a-f0-9]{32}[.]testnet$' or p_secret !~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{64,88}$' then raise exception 'Invalid referee setup';end if;
    insert into public.game_arena_runtime(account_id,secret_id,contract_id) values(p_account,vault.create_secret(p_secret,'copper/referee','Game-owned testnet referee key'),'r.'||p_account);
  end if;
end $$;
create function public.arena_signing_key() returns text language sql security invoker set search_path='' as $$
 select s.decrypted_secret from public.game_arena_runtime r join vault.decrypted_secrets s on s.id=r.secret_id where r.singleton;
$$;
create function public.claim_arena_faucet() returns boolean language plpgsql security invoker set search_path='' as $$
begin update public.game_arena_runtime set faucet_requested_at=now() where singleton and faucet_requested_at is null;return found;end$$;
create function public.save_arena_setup(p_signed text,p_hash text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.game_arena_runtime;begin
  update public.game_arena_runtime set signed_tx=p_signed,tx_hash=p_hash where singleton and signed_tx is null;
  select * into r from public.game_arena_runtime where singleton;return to_jsonb(r)-'secret_id';
end$$;
create function public.claim_duel_report(p_match uuid,p_report jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.game_duel_outbox;
begin
  perform pg_catalog.pg_advisory_xact_lock(49110416);
  if not exists(select 1 from public.game_arena_state where state->'settlements'->p_match::text->'result'=p_report) then raise exception 'No verified completed duel' using errcode='42501';end if;
  insert into public.game_duel_outbox(match_id,report) values(p_match,p_report) on conflict do nothing;
  select * into r from public.game_duel_outbox where match_id=p_match for update;
  if r.report<>p_report then raise exception 'Conflicting result';end if;
  if r.signed_tx is not null or r.status<>'pending' then return to_jsonb(r)||jsonb_build_object('claimed',false);end if;
  if r.attempts>=5 or r.lease_until>now() or exists(select 1 from public.game_duel_outbox where match_id<>p_match and status='pending' and (signed_tx is not null or lease_until>now())) then return to_jsonb(r)||jsonb_build_object('claimed',false);end if;
  update public.game_duel_outbox set attempts=attempts+1,claim_id=gen_random_uuid(),lease_until=now()+interval '90 seconds' where match_id=p_match returning * into r;
  return to_jsonb(r)||jsonb_build_object('claimed',true);
end$$;
create function public.save_duel_transaction(p_match uuid,p_claim uuid,p_signed text,p_hash text) returns boolean
language plpgsql security invoker set search_path='' as $$
begin update public.game_duel_outbox set signed_tx=p_signed,tx_hash=p_hash where match_id=p_match and claim_id=p_claim and lease_until>now() and signed_tx is null and status='pending';return found;end$$;
create function public.confirm_duel_report(p_match uuid,p_report jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin update public.game_duel_outbox set status=case when report=p_report then 'confirmed' else 'conflict' end where match_id=p_match;end$$;

revoke all on function public.ensure_arena_runtime(text,text),public.arena_signing_key(),public.claim_arena_faucet(),public.save_arena_setup(text,text),public.claim_duel_report(uuid,jsonb),public.save_duel_transaction(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ensure_arena_runtime(text,text),public.arena_signing_key(),public.claim_arena_faucet(),public.save_arena_setup(text,text),public.claim_duel_report(uuid,jsonb),public.save_duel_transaction(uuid,uuid,text,text) to service_role;
revoke all on function public.confirm_duel_report(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_duel_report(uuid,jsonb) to service_role;

revoke all on function public.begin_wallet_challenge(uuid,uuid,uuid,uuid,text,text),public.bind_owned_wallet(uuid,uuid,uuid,text,text,text),
 public.claim_owned_faucet(uuid,uuid,uuid),public.begin_npc_turn(uuid,uuid,uuid,uuid,text),
 public.finish_npc_turn(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text),public.reserve_npc_judgment(uuid,uuid,uuid,uuid,text),
 public.finish_npc_judgment(uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.begin_wallet_challenge(uuid,uuid,uuid,uuid,text,text),public.bind_owned_wallet(uuid,uuid,uuid,text,text,text),
 public.claim_owned_faucet(uuid,uuid,uuid),public.begin_npc_turn(uuid,uuid,uuid,uuid,text),
 public.finish_npc_turn(uuid,uuid,uuid,uuid,uuid,jsonb,jsonb,text),public.reserve_npc_judgment(uuid,uuid,uuid,uuid,text),
 public.finish_npc_judgment(uuid,uuid,uuid,jsonb) to service_role;

commit;
