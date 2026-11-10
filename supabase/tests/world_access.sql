begin;

-- Fictional identities exist only inside this rollback test.
insert into auth.users (id, aud, role, is_anonymous) values
  ('ba300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', false),
  ('ba300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', false);
insert into public.game_worlds (user_id) values
  ('ba300000-0000-4000-8000-000000000001'),
  ('ba300000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"ba300000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}', true);
do $$
begin
  if (select count(*) from public.game_worlds) <> 1 or
     (select count(*) from public.game_worlds where user_id = 'ba300000-0000-4000-8000-000000000002') <> 0 then
    raise exception 'World isolation failed';
  end if;
  begin
    insert into public.game_worlds (user_id) values ('ba300000-0000-4000-8000-000000000001');
    raise exception 'Direct insert was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.game_worlds set status = 'paused';
    raise exception 'Direct update was allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.game_worlds;
    raise exception 'Direct delete was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

select set_config('request.jwt.claims', '{"sub":"ba300000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":true}', true);
do $$ begin
  if (select count(*) from public.game_worlds) <> 0 then raise exception 'Anonymous identity can read a world'; end if;
end $$;

set local role anon;
do $$ begin
  begin
    perform * from public.game_worlds;
    raise exception 'Unauthenticated access was allowed';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  begin
    insert into public.game_worlds (user_id) values ('ba300000-0000-4000-8000-000000000001');
    raise exception 'Duplicate owner was allowed';
  exception when unique_violation then null;
  end;
  begin
    update public.game_worlds set status = 'ready' where user_id = 'ba300000-0000-4000-8000-000000000001';
    raise exception 'Unfunded world marked ready without a contract';
  exception when check_violation then null;
  end;
end $$;

rollback;
select 'World isolation, denied writes, uniqueness, pending-state checks passed; fictional rows rolled back.' as result;
