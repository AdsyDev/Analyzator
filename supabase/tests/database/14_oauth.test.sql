-- OAuth (D-8): oauth_states doar pentru service role; rotate_source_token doar service role, doar conturi OAuth.
-- T1 = 1000…0001 · admin T1 = 3000…0001
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

insert into public.oauth_states (state_hash, tenant_id, provider, actor_user_id, expires_at)
values (repeat('c', 64), '10000000-0000-0000-0000-000000000001', 'google_ads', '30000000-0000-0000-0000-000000000001', now() + interval '10 minutes');

-- K1. Utilizatorii nu ating oauth_states ---------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select 1 from public.oauth_states $$, '42501', null, 'K1: agency_admin nu citește oauth_states');
select throws_ok($$ insert into public.oauth_states (state_hash, tenant_id, provider, actor_user_id, expires_at)
  values (repeat('d', 64), '10000000-0000-0000-0000-000000000001', 'tiktok_ads', '30000000-0000-0000-0000-000000000001', now() + interval '5 minutes') $$,
  '42501', null, 'K1: agency_admin nu scrie oauth_states');
select tests.authenticate_as_anon();
select throws_ok($$ select 1 from public.oauth_states $$, '42501', null, 'K1: anon nu citește oauth_states');
reset role;
select throws_ok($$ insert into public.oauth_states (state_hash, tenant_id, provider, actor_user_id, expires_at)
  values (repeat('e', 64), '10000000-0000-0000-0000-000000000001', 'google_ads', '30000000-0000-0000-0000-000000000001', now() + interval '2 hours') $$,
  '23514', null, 'K1: un state nu poate trăi mai mult de 30 de minute');

-- K2. rotate_source_token ------------------------------------------------------------------------------------
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', null, 'tiktok_account', 'TikTok Business');
insert into ctx select 'tt', id from public.source_connections where provider = 'tiktok_account';
select tests.authenticate_as_service_role();
select public.set_source_token('30000000-0000-0000-0000-000000000001', (select v from ctx where k = 'tt'), '{"access_token":"vechi"}');
select is(public.rotate_source_token((select v from ctx where k = 'tt'), '{"access_token":"nou"}'), 'unverified', 'K2: tokenul reînnoit păstrează starea');
select is(public.get_source_token((select v from ctx where k = 'tt')), '{"access_token":"nou"}', 'K2: workerul citește tokenul reînnoit');
select throws_ok($$ select public.rotate_source_token('50000000-0000-0000-0000-000000000031', 'x') $$, '42501', null,
  'K2: un token Clarity nu se reînnoiește automat');
reset role;
select ok(exists (select 1 from public.audit_events where action = 'credential_refreshed' and actor_type = 'worker' and entity_id = (select v from ctx where k = 'tt')::text),
  'K2: reînnoirea e auditată ca worker');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select throws_ok($$ select public.rotate_source_token((select v from ctx where k = 'tt'), 'x') $$, '42501', null, 'K2: authenticated nu execută rotate_source_token');
reset role;

select * from finish();
rollback;
