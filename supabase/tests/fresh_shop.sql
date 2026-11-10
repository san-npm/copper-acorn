-- Fictional isolated worlds only; no faucet, keys, migration of inventory or chain writes.
begin;
create temporary table fresh_check_ids(owner_id uuid,other_id uuid,session_id uuid);
insert into fresh_check_ids values(gen_random_uuid(),gen_random_uuid(),gen_random_uuid());
insert into auth.users(id) select owner_id from fresh_check_ids union all select other_id from fresh_check_ids;
insert into auth.sessions(id,user_id) select session_id,owner_id from fresh_check_ids;
grant select,update on fresh_check_ids to service_role;
grant select on fresh_check_ids to authenticated;
set local role service_role;
do $$
declare t record; old_id uuid; fresh_id uuid; op jsonb;
begin
  select * into t from fresh_check_ids;
  old_id:=public.ensure_active_game_world(t.owner_id);
  if public.ensure_active_game_world(t.owner_id)<>old_id then raise exception 'Initial setup changed shop'; end if;
  update public.game_worlds set status='ready',contract_id='old-fictional.testnet' where id=old_id;
  insert into public.game_player_wallets(world_id,account_id,public_key,secret_id,funded_at)
    values(old_id,'ca-'||replace(old_id::text,'-','')||'.testnet','ed25519:'||repeat('3',32),vault.create_secret('old-fictional-key'),now());
  fresh_id:=public.prepare_fresh_game_world(t.owner_id,t.session_id,old_id);
  if public.prepare_fresh_game_world(t.owner_id,t.session_id,old_id)<>fresh_id then raise exception 'Retry created a third shop'; end if;
  if public.ensure_active_game_world(t.owner_id)<>old_id or (select is_active from public.game_worlds where id=fresh_id)
    then raise exception 'Preparation switched the default'; end if;
  if exists(select 1 from public.game_player_wallets where world_id=fresh_id) then raise exception 'Preparation created a wallet'; end if;
  begin
    perform public.prepare_fresh_game_world(t.other_id,t.session_id,old_id);raise exception 'Foreign owner accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.prepare_fresh_game_world(t.owner_id,gen_random_uuid(),old_id);raise exception 'Revoked session accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.activate_game_world(t.owner_id,t.session_id,fresh_id,old_id);raise exception 'Unfunded shop activated';
  exception when object_not_in_prerequisite_state then null; end;
  begin
    perform public.begin_game_operation(fresh_id,t.owner_id,'inactive-trade','{"kind":"gather"}');raise exception 'Inactive trade accepted';
  exception when insufficient_privilege then null; end;
  op:=public.begin_game_operation(fresh_id,t.owner_id,'fresh-setup','{"kind":"setup","role":"owner"}');
  perform public.finish_game_operation(fresh_id,'fresh-setup','failed','{}','fictional setup only');
  update public.game_worlds set status='ready',contract_id='fresh-fictional.testnet' where id=fresh_id;
  insert into public.game_player_wallets(world_id,account_id,public_key,secret_id,funded_at)
    values(fresh_id,'ca-'||replace(fresh_id::text,'-','')||'.testnet','ed25519:'||repeat('4',32),vault.create_secret('fresh-fictional-key'),now());
  op:=public.begin_game_operation(old_id,t.owner_id,'pending-old-action','{"kind":"gather"}');
  perform public.save_game_transaction(old_id,'pending-old-action',(op->>'claim_id')::uuid,'fictional-signed','old-hash','old-fictional.testnet',null);
  begin
    perform public.activate_game_world(t.owner_id,t.session_id,fresh_id,old_id);raise exception 'Pending shop switched';
  exception when lock_not_available then null; end;
  perform public.finish_game_operation(old_id,'pending-old-action','confirmed','{"hash":"old-hash"}',null);
  perform public.activate_game_world(t.owner_id,t.session_id,fresh_id,old_id);
  perform public.activate_game_world(t.owner_id,t.session_id,fresh_id,old_id);
  if public.ensure_active_game_world(t.owner_id)<>fresh_id then raise exception 'Login did not select fresh shop'; end if;
  if (select count(*) from public.game_worlds where user_id=t.owner_id)<>2
    or (select count(*) from public.game_worlds where user_id=t.owner_id and is_active)<>1 then raise exception 'Shop count changed'; end if;
  if not exists(select 1 from public.game_operations where world_id=old_id and tx_hash='old-hash' and status='confirmed')
    or exists(select 1 from public.game_operations where world_id=fresh_id and tx_hash='old-hash') then raise exception 'Journal crossed shops'; end if;
  if not exists(select 1 from public.game_player_wallets where world_id=old_id and public_key='ed25519:'||repeat('3',32)) then raise exception 'Old wallet replaced'; end if;
  begin
    perform public.begin_game_operation(old_id,t.owner_id,'late-old-action','{"kind":"brew"}');raise exception 'Late old action accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.activate_game_world(t.owner_id,t.session_id,old_id,old_id);raise exception 'Stale default accepted';
  exception when serialization_failure then null; end;
  begin
    perform public.prepare_fresh_game_world(t.owner_id,t.session_id,fresh_id);raise exception 'Third shop created';
  exception when raise_exception then
    if sqlerrm <> 'Development shop limit reached' then raise; end if;
  end;
  perform public.activate_game_world(t.owner_id,t.session_id,old_id,fresh_id);
  if public.ensure_active_game_world(t.owner_id)<>old_id then raise exception 'Return to preserved shop failed'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon','public.prepare_fresh_game_world(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.activate_game_world(uuid,uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','public.ensure_active_game_world(uuid)','execute')
    then raise exception 'Administrative setup RPC is public'; end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select owner_id from fresh_check_ids),'is_anonymous',false)::text,true);
do $$ begin
  if (select count(*) from public.game_worlds)<>2 then raise exception 'Owner cannot read preserved shops or sees foreign shops'; end if;
  begin
    update public.game_worlds set is_active=false;raise exception 'Client switched default';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
