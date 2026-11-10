begin;
create or replace function public.register_game_wallet(p_world_id uuid, p_owner_id uuid, p_public_key text, p_secret_key text)
returns table(account_id text, public_key text, funding_requested_at timestamptz, faucet_http_status smallint, funded_at timestamptz)
language plpgsql security invoker set search_path = '' as $$
declare
  stored_secret uuid;
begin
  -- Serialize the global development cap as well as duplicate requests for one world.
  perform pg_catalog.pg_advisory_xact_lock(48281741906001);
  if not exists (select 1 from public.game_worlds w where w.id = p_world_id and w.user_id = p_owner_id) then
    raise exception 'World is not available' using errcode = '42501';
  end if;
  if not exists (select 1 from public.game_player_wallets w where w.world_id = p_world_id) then
    -- Ten wallets total for this authenticated testnet playtest; no paid funding or uncapped creation.
    if (select count(*) from public.game_player_wallets) >= 10 then
      raise exception 'The ten-wallet playtest capacity is reached';
    end if;
    if p_public_key !~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$' or
       p_secret_key !~ '^ed25519:[1-9A-HJ-NP-Za-km-z]{64,88}$' then
      raise exception 'Invalid wallet key format';
    end if;
    stored_secret := vault.create_secret(p_secret_key, 'briarbridge/player/' || p_world_id::text, 'Custodial NEAR testnet player key');
    insert into public.game_player_wallets (world_id, account_id, public_key, secret_id)
      values (p_world_id, 'ca-' || replace(p_world_id::text, '-', '') || '.testnet', p_public_key, stored_secret);
  end if;
  return query select w.account_id, w.public_key, w.funding_requested_at, w.faucet_http_status, w.funded_at
    from public.game_player_wallets w where w.world_id = p_world_id;
end $$;
revoke all on function public.register_game_wallet(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.register_game_wallet(uuid,uuid,text,text) to service_role;
commit;
