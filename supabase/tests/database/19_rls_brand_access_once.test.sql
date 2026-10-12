-- E9 / D-20: politicile SELECT ale tabelelor de date folosesc accessible_brand_ids() (o dată pe interogare), cu exact
-- aceeași regulă ca has_brand_access. T1 = 1000…0001 (1A = 2000…0011, 1B = 2000…0012); T2 = 1000…0002 (2A, 2B).
-- strategist T1 = 3000…0002 (doar 1A) · admin T1 = 3000…0001 · client T1 cu acces la 1A = 3000…0004 · client fără acces = 3000…0005
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- R1. Toate cele 21 de politici de date folosesc noua funcție; nicio politică de date nu mai apelează has_brand_access pe rând.
select is(
  (select count(*)::integer from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual like '%accessible_brand_ids()%'),
  21, 'R1: 21 de politici SELECT folosesc accessible_brand_ids()');
select is_empty(
  $$ select tablename from pg_policies where schemaname = 'public' and cmd = 'SELECT' and qual = 'private.has_brand_access(brand_id)' $$,
  'R1: nicio politică de date nu mai evaluează has_brand_access pe fiecare rând');

-- R2. Echivalență: pentru fiecare utilizator, accessible_brand_ids = brandurile cu has_brand_access adevărat.
create temporary table users_under_test (id uuid) on commit drop;
insert into users_under_test values ('30000000-0000-0000-0000-000000000001'), ('30000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000004'), ('30000000-0000-0000-0000-000000000005'), ('30000000-0000-0000-0000-000000000012');
grant select on users_under_test to public;

select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select set_eq($$ select private.accessible_brand_ids() $$, $$ values ('20000000-0000-0000-0000-000000000011'::uuid) $$,
  'R2: strategistul T1 are doar 1A');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select is_empty($$ select private.accessible_brand_ids() $$, 'R2: clientul fără acces nu are niciun brand');
select tests.authenticate_as('30000000-0000-0000-0000-000000000012');
select ok(not exists (select 1 from private.accessible_brand_ids() b where b in ('20000000-0000-0000-0000-000000000011', '20000000-0000-0000-0000-000000000012')),
  'R2: strategistul T2 nu primește branduri din T1');
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select set_eq($$ select private.accessible_brand_ids() $$,
  $$ select b.id from public.brands b where private.has_brand_access(b.id) $$,
  'R2: adminul T1, aceeași mulțime ca has_brand_access');

-- R3. anon nu poate apela funcția; ea rulează cu drepturile apelantului (SECURITY INVOKER, nu ocolește RLS).
reset role;
select ok(not (select prosecdef from pg_proc where oid = 'private.accessible_brand_ids()'::regprocedure), 'R3: accessible_brand_ids e SECURITY INVOKER');
select ok(not has_function_privilege('anon', 'private.accessible_brand_ids()', 'execute'), 'R3: anon nu execută accessible_brand_ids');

select * from finish();
rollback;
