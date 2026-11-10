create table public.game_worlds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  network text not null default 'testnet' check (network = 'testnet'),
  status text not null default 'pending' check (status in ('pending', 'provisioning', 'ready', 'paused')),
  contract_id text unique check (
    contract_id is null or (
      char_length(contract_id) <= 64 and
      contract_id ~ '^[a-z0-9]+([._-][a-z0-9]+)*[.]testnet$'
    )
  ),
  created_at timestamptz not null default now(),
  constraint ready_world_has_contract check (status <> 'ready' or contract_id is not null)
);

alter table public.game_worlds enable row level security;
revoke all on public.game_worlds from public, anon, authenticated;
grant select on public.game_worlds to authenticated;
grant all on public.game_worlds to service_role;

create policy read_own_world on public.game_worlds
  for select to authenticated
  using (
    (select auth.uid()) = user_id and
    coalesce((select auth.jwt())->>'is_anonymous', 'false') = 'false'
  );

comment on table public.game_worlds is
  'Server-managed identity-to-testnet-world binding. No balances or wallet keys. Pending does not mean a funded shop exists.';
