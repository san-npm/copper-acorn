-- Fictional isolated rows only; existing wallets/worlds are never modified. Always roll back.
begin;
create temporary table game_check_ids(owner_id uuid,world_id uuid,session_id uuid);
insert into game_check_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id) select owner_id from game_check_ids;
insert into auth.sessions(id,user_id) select session_id,owner_id from game_check_ids;
insert into public.game_worlds(id,user_id) select world_id,owner_id from game_check_ids;
insert into public.game_player_wallets(world_id,account_id,public_key,secret_id)
  select world_id,'ca-'||replace(world_id::text,'-','')||'.testnet','ed25519:'||repeat('1',32),
    vault.create_secret('ed25519:'||repeat('1',64),'fictional-persistence-check/'||world_id::text) from game_check_ids;
grant select on game_check_ids to service_role;
set local role service_role;
do $$
declare
  t record;
  op jsonb;
  again jsonb;
  keys jsonb;
begin
  select * into t from game_check_ids;
  select jsonb_object_agg(k,'ed25519:'||repeat('2',64)) into keys
    from unnest(array['owner','mira','rowan','bram','customer','treasury']) k;
  if not public.game_session_active(t.owner_id,t.session_id) then raise exception 'Active session was rejected'; end if;
  perform public.ensure_game_runtime(t.world_id,t.owner_id,keys);
  perform public.ensure_game_runtime(t.world_id,t.owner_id,jsonb_build_object('ignored','invalid'));
  if public.game_signing_key(t.world_id,t.owner_id,t.session_id,'player') <> 'ed25519:'||repeat('1',64) then raise exception 'Player key did not restore'; end if;
  if public.game_signing_key(t.world_id,t.owner_id,t.session_id,'owner') <> 'ed25519:'||repeat('2',64) then raise exception 'Runtime key was replaced'; end if;
  begin
    perform public.game_signing_key(t.world_id,t.owner_id,gen_random_uuid(),'player');
    raise exception 'Revoked session was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.game_signing_key(t.world_id,gen_random_uuid(),t.session_id,'player');
    raise exception 'Foreign owner was accepted';
  exception when insufficient_privilege then null; end;
  op:=public.begin_game_operation(t.world_id,t.owner_id,'first-action','{"kind":"gather","token_id":"sunleaf"}');
  again:=public.begin_game_operation(t.world_id,t.owner_id,'first-action','{"token_id":"sunleaf","kind":"gather"}');
  if op <> again then raise exception 'Duplicate changed its claim'; end if;
  begin
    perform public.begin_game_operation(t.world_id,t.owner_id,'first-action','{"kind":"brew"}');
    raise exception 'Payload conflict accepted';
  exception when unique_violation then null; end;
  begin
    perform public.begin_game_operation(t.world_id,t.owner_id,'second-action','{"kind":"brew"}');
    raise exception 'Concurrent world action accepted';
  exception when lock_not_available then null; end;
  if public.save_game_transaction(t.world_id,'first-action',gen_random_uuid(),'fake-signed','fake-hash','fictional.testnet',0) then raise exception 'Wrong claim accepted'; end if;
  if not public.save_game_transaction(t.world_id,'first-action',(op->>'claim_id')::uuid,'fake-signed','fake-hash','fictional.testnet',0) then raise exception 'Claim not saved'; end if;
  if public.save_game_transaction(t.world_id,'first-action',(op->>'claim_id')::uuid,'replaced','changed','fictional.testnet',null) then raise exception 'Signed bytes replaced'; end if;
  perform public.finish_game_operation(t.world_id,'first-action','confirmed','{"hash":"fake-hash"}',null);
  perform public.finish_game_operation(t.world_id,'first-action','failed','{}','late error');
  if (select status from public.game_operations where world_id=t.world_id and request_id='first-action') <> 'confirmed' then raise exception 'Terminal outcome replaced'; end if;
  if (select served_day from public.game_runtime where world_id=t.world_id) <> 0 then raise exception 'Visit progress not persisted'; end if;
  op:=public.begin_game_operation(t.world_id,t.owner_id,'stale-action','{"kind":"brew"}');
  update public.game_operations set lease_until=now()-interval '1 second' where world_id=t.world_id and request_id='stale-action';
  perform public.begin_game_operation(t.world_id,t.owner_id,'third-action','{"kind":"list"}');
  if public.save_game_transaction(t.world_id,'stale-action',(op->>'claim_id')::uuid,'stale','stale','fictional.testnet',null) then raise exception 'Stale worker published'; end if;
end $$;
reset role;
do $$
declare t record;
begin
  select * into t from game_check_ids;
  delete from auth.sessions where id=t.session_id;
  if public.game_session_active(t.owner_id,t.session_id) then raise exception 'Deleted session stayed active'; end if;
  if has_function_privilege('authenticated','public.game_signing_key(uuid,uuid,uuid,text)','EXECUTE')
    or has_function_privilege('anon','public.begin_game_operation(uuid,uuid,text,jsonb)','EXECUTE')
    or has_table_privilege('authenticated','public.game_operations','SELECT')
    or has_table_privilege('anon','public.game_runtime','SELECT') then raise exception 'Client privileges exposed'; end if;
end $$;
rollback;
