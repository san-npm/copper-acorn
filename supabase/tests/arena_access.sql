-- Fictional isolated rows; no owner games, keys or balances are changed.
begin;
create temporary table arena_check_ids(owner_id uuid,world_id uuid,session_id uuid);
insert into arena_check_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id) select owner_id from arena_check_ids;
insert into auth.sessions(id,user_id) select session_id,owner_id from arena_check_ids;
insert into public.game_worlds(id,user_id,status,contract_id) select world_id,owner_id,'ready','arena-check-'||replace(world_id::text,'-','')||'.testnet' from arena_check_ids;
grant select on arena_check_ids to service_role;
set local role service_role;
do $$
declare t record; v bigint; s jsonb;
begin
  select * into t from arena_check_ids;
  select revision,state into v,s from public.game_arena_state;
  if not public.commit_game_arena(t.owner_id,t.session_id,t.world_id,v,s) then raise exception 'Valid arena commit failed'; end if;
  if public.commit_game_arena(t.owner_id,t.session_id,t.world_id,v,s) then raise exception 'Stale revision was accepted'; end if;
  begin
    perform public.commit_game_arena(gen_random_uuid(),t.session_id,t.world_id,v+1,s);
    raise exception 'Foreign owner was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.commit_game_arena(t.owner_id,gen_random_uuid(),t.world_id,v+1,s);
    raise exception 'Revoked session was accepted';
  exception when insufficient_privilege then null; end;
  update public.game_worlds set is_active=false where id=t.world_id;
  begin
    perform public.commit_game_arena(t.owner_id,t.session_id,t.world_id,v+1,s);
    raise exception 'Inactive world was accepted';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role authenticated;
do $$ begin
  begin perform * from public.game_arena_state;raise exception 'Authenticated client read private arena state';exception when insufficient_privilege then null;end;
  begin perform public.commit_game_arena(gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),0,'{}');raise exception 'Authenticated client wrote arena state';exception when insufficient_privilege then null;end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform * from public.game_arena_state;raise exception 'Anonymous client read private arena state';exception when insufficient_privilege then null;end;
end $$;
reset role;
rollback;
