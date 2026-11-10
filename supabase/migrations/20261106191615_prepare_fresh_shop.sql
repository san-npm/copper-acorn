begin;

-- Existing worlds, keys and journals keep their IDs. New shops start inactive.
alter table public.game_worlds
  add column is_active boolean not null default true,
  add column previous_world_id uuid unique references public.game_worlds(id) on delete restrict,
  add constraint distinct_previous_world check (previous_world_id <> id);
alter table public.game_worlds drop constraint game_worlds_user_id_key;
create unique index game_one_active_world on public.game_worlds(user_id) where is_active;

create function public.ensure_active_game_world(p_owner uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare target uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,48281741906002));
  select id into target from public.game_worlds where user_id=p_owner and is_active;
  if target is null then
    if exists(select 1 from public.game_worlds where user_id=p_owner) then
      raise exception 'No active shop; preserve existing worlds' using errcode='55000';
    end if;
    insert into public.game_worlds(user_id) values(p_owner) returning id into target;
  end if;
  return target;
end $$;

create function public.prepare_fresh_game_world(p_owner uuid,p_session uuid,p_previous uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare prior public.game_worlds; target uuid;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,48281741906002));
  select * into prior from public.game_worlds where id=p_previous and user_id=p_owner for update;
  if not found or prior.status <> 'ready' then raise exception 'Previous shop unavailable' using errcode='42501'; end if;
  select id into target from public.game_worlds where previous_world_id=p_previous and user_id=p_owner;
  if target is not null then return target; end if;
  if not prior.is_active then raise exception 'Previous shop is not active' using errcode='55000'; end if;
  -- shortcut: one replacement per owner for this development release; review free funding before widening access.
  if (select count(*) from public.game_worlds where user_id=p_owner) >= 2 then raise exception 'Development shop limit reached'; end if;
  insert into public.game_worlds(user_id,is_active,previous_world_id) values(p_owner,false,p_previous) returning id into target;
  return target;
end $$;

create function public.activate_game_world(p_owner uuid,p_session uuid,p_world uuid,p_expected_active uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare current_id uuid;
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_owner::text,48281741906002));
  -- The same rows are locked by begin_game_operation, so switching cannot race a new action.
  perform 1 from public.game_worlds where user_id=p_owner order by id for update;
  select id into current_id from public.game_worlds where user_id=p_owner and is_active;
  if not exists(select 1 from public.game_worlds g join public.game_player_wallets w on w.world_id=g.id
    where g.id=p_world and g.user_id=p_owner and g.status='ready' and w.funded_at is not null)
    then raise exception 'Target shop is not ready and funded' using errcode='55000'; end if;
  if current_id=p_world then return p_world; end if;
  if current_id is distinct from p_expected_active then raise exception 'Active shop changed' using errcode='40001'; end if;
  if exists(select 1 from public.game_operations where world_id in (current_id,p_world) and status in ('preparing','pending'))
    then raise exception 'A previous action needs confirmation' using errcode='55P03'; end if;
  update public.game_worlds set is_active=false where id=current_id;
  update public.game_worlds set is_active=true where id=p_world;
  return p_world;
end $$;

create function public.guard_inactive_game_operation() returns trigger
language plpgsql security invoker set search_path='' as $$
declare active boolean;
begin
  select is_active into active from public.game_worlds where id=new.world_id for share;
  if active is not true and new.action->>'kind' is distinct from 'setup' then
    raise exception 'Shop is inactive; refresh your account' using errcode='42501';
  end if;
  return new;
end $$;
create trigger game_operation_active_world before insert on public.game_operations
  for each row execute function public.guard_inactive_game_operation();

revoke all on function public.ensure_active_game_world(uuid),public.prepare_fresh_game_world(uuid,uuid,uuid),
  public.activate_game_world(uuid,uuid,uuid,uuid),public.guard_inactive_game_operation() from public,anon,authenticated;
grant execute on function public.ensure_active_game_world(uuid),public.prepare_fresh_game_world(uuid,uuid,uuid),
  public.activate_game_world(uuid,uuid,uuid,uuid),public.guard_inactive_game_operation() to service_role;

commit;
