begin;

-- shortcut: one revisioned courtyard for this small playtest; shard matches before a larger public launch.
create table public.game_arena_state (
  singleton boolean primary key default true check(singleton),
  revision bigint not null default 0 check(revision>=0),
  state jsonb not null check(jsonb_typeof(state)='object' and octet_length(state::text)<=2097152)
);
alter table public.game_arena_state enable row level security;
revoke all on public.game_arena_state from public,anon,authenticated;
grant select,update on public.game_arena_state to service_role;
insert into public.game_arena_state(state) values('{"version":1,"profiles":{},"matches":{},"invites":[],"requests":{}}');

create function public.commit_game_arena(p_owner uuid,p_session uuid,p_world uuid,p_revision bigint,p_state jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
  if not public.game_session_active(p_owner,p_session) then raise exception 'Session unavailable' using errcode='42501'; end if;
  perform 1 from public.game_worlds where id=p_world and user_id=p_owner and is_active and status='ready' for share;
  if not found then raise exception 'Active shop unavailable' using errcode='42501'; end if;
  if p_revision<0 or p_state->>'version' is distinct from '1' or jsonb_typeof(p_state->'profiles') is distinct from 'object'
    or jsonb_typeof(p_state->'matches') is distinct from 'object' or jsonb_typeof(p_state->'invites') is distinct from 'array'
    or jsonb_typeof(p_state->'requests') is distinct from 'object' then raise exception 'Invalid arena state'; end if;
  update public.game_arena_state set state=p_state,revision=revision+1 where singleton and revision=p_revision;
  return found;
end $$;
revoke all on function public.commit_game_arena(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.commit_game_arena(uuid,uuid,uuid,bigint,jsonb) to service_role;

commit;
