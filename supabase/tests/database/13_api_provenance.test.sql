-- Date prin API în tabelele de import (decizia D-4): proveniența unică și statusul sursei.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;

insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-1a');
insert into ctx select 'conn', id from public.source_connections where provider = 'planable' and external_account_id = 'ws-1a';

-- J1. Fără rulare API și fără import: sursa nu e conectată -------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select connected from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'planable_analytics'), false,
  'J1: fără import și fără rulare API, Planable nu e conectat');
reset role;

insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_analytics',
        current_date - 35, current_date - 1, 'partial', 3, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source = 'planable_analytics' and brand_id = '20000000-0000-0000-0000-000000000011';

-- J2. Proveniența: exact una din CSV sau API ----------------------------------------------------------
select lives_ok($$
  insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, followers, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'pg-1', current_date - 2, 10, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't',
          (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'))
$$, 'J2: rând API cu conexiune și rulare');
select throws_ok($$
  insert into public.social_daily (tenant_id, brand_id, platform, account_id, date, collected_at, collection_method, payload_hash, source_timezone, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'pg-1', current_date - 3, now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't')
$$, '23514', null, 'J2: rând API fără conexiune și rulare e respins');
select throws_ok($$
  insert into public.mentions (tenant_id, brand_id, native_id, url, published_at, collected_at, collection_method, payload_hash, source_timezone, schema_version)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'h:x', 'https://x.test/1', now(), now(), 'csv', repeat('a', 64), 'Europe/Bucharest', 't')
$$, '23514', null, 'J2: rând CSV fără lot e respins');
select throws_ok($$
  insert into public.social_posts (tenant_id, brand_id, platform, account_id, post_id, snapshot_date, metrics_scope, published_at, collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id, row_number)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'instagram', 'pg-1', 'p1', current_date, 'lifetime', now(), now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't',
          (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'), 1)
$$, '23514', null, 'J2: un rând nu poate avea ambele proveniențe');

-- J3. O rulare API parțială face sursa conectată și se vede ca parțială ---------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
select is((select connected from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'planable_analytics'), true,
  'J3: o rulare API reușită sau parțială contează ca import');
select is((select last_run_status::text from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'planable_analytics'), 'partial',
  'J3: statusul ultimei rulări API e vizibil (parțial)');
select is((select data_as_of from public.source_status where brand_id = '20000000-0000-0000-0000-000000000011' and source = 'planable_analytics'), current_date - 2,
  'J3: data_as_of vine din rândurile API');
reset role;

select * from finish();
rollback;
