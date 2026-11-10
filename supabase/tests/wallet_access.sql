begin;
-- Run in an isolated wallet environment, before issuing real player keys.
do $$ begin
  if exists (select 1 from public.game_player_wallets) then raise exception 'Wallet test requires an empty wallet environment'; end if;
end $$;
insert into auth.users(id, aud, role, is_anonymous) values
 ('ba400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', false),
 ('ba400000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', false),
 ('ba400000-0000-4000-8000-000000000021', 'authenticated', 'authenticated', false);
insert into public.game_worlds(id, user_id) values
 ('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001'),
 ('ba400000-0000-4000-8000-000000000012', 'ba400000-0000-4000-8000-000000000011'),
 ('ba400000-0000-4000-8000-000000000022', 'ba400000-0000-4000-8000-000000000021');
set local role service_role;
do $$
declare original_key text; capacity_blocked boolean := false;
begin
  perform public.register_game_wallet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001', 'ed25519:' || repeat('1',32), 'ed25519:' || repeat('1',88));
  select public_key into original_key from public.game_player_wallets;
  perform public.register_game_wallet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001', 'ed25519:' || repeat('2',32), 'ed25519:' || repeat('2',88));
  if (select count(*) from public.game_player_wallets) <> 1 or (select public_key from public.game_player_wallets) <> original_key then raise exception 'Duplicate setup changed the wallet'; end if;
  if not exists (select 1 from public.game_player_wallets w join vault.secrets s on s.id = w.secret_id join vault.decrypted_secrets d on d.id = s.id where s.secret <> 'ed25519:' || repeat('1',88) and d.decrypted_secret = 'ed25519:' || repeat('1',88)) then raise exception 'Encrypted key roundtrip failed'; end if;
  if not public.claim_game_wallet_faucet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001') then raise exception 'Initial claim failed'; end if;
  if public.claim_game_wallet_faucet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001') then raise exception 'Funding can be claimed twice'; end if;
  begin
    perform public.register_game_wallet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000099', 'ed25519:' || repeat('2',32), 'ed25519:' || repeat('2',88));
    raise exception 'Wrong owner accepted';
  exception when insufficient_privilege then null;
  end;
  perform public.register_game_wallet('ba400000-0000-4000-8000-000000000012', 'ba400000-0000-4000-8000-000000000011', 'ed25519:' || repeat('2',32), 'ed25519:' || repeat('2',88));
  begin
    perform public.register_game_wallet('ba400000-0000-4000-8000-000000000022', 'ba400000-0000-4000-8000-000000000021', 'ed25519:' || repeat('3',32), 'ed25519:' || repeat('3',88));
  exception when raise_exception then
    if sqlerrm <> 'Development wallet capacity reached' then raise; end if;
    capacity_blocked := true;
  end;
  if not capacity_blocked then raise exception 'Global capacity was not enforced'; end if;
end $$;
set local role authenticated;
do $$ begin
  begin perform * from public.game_player_wallets; raise exception 'Direct wallet read allowed'; exception when insufficient_privilege then null; end;
  begin perform public.register_game_wallet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001', 'ed25519:' || repeat('1',32), 'ed25519:' || repeat('1',88)); raise exception 'Client wallet registration allowed'; exception when insufficient_privilege then null; end;
  begin perform * from vault.decrypted_secrets; raise exception 'Client key read allowed'; exception when insufficient_privilege then null; end;
end $$;
set local role anon;
do $$ begin
  begin perform public.claim_game_wallet_faucet('ba400000-0000-4000-8000-000000000002', 'ba400000-0000-4000-8000-000000000001'); raise exception 'Anonymous funding claim allowed'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Key encryption, retained identity, owner checks, one-attempt funding and client isolation passed; fictional secrets rolled back.' as result;
