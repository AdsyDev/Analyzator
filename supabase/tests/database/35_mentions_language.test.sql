-- Listening doar în română (deciziile AC). Date SINTETICE, doar aici; textele de test imită mențiunile reale din 23 nov. 2026.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · admin T1 = 3000…0001 · client T1 (acces 1A) = 3000…0004 · client T2 = 3000…0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- L1. Clasificatorul: ro / other / NULL (nedeterminată) -------------------------------------------------------------------------
select is(metrics.text_language_v1('Înainte de antrenament sau după ultimul punct? Tu alegi momentul. Proenzi se consumă direct din flacon: o doză pe zi, fără dizolvare.'), 'ro', 'L1: română cu diacritice');
select is(metrics.text_language_v1('Disconfortul și rigiditatea articulară îți pot afecta ritmul de zi cu zi.'), 'ro', 'L1: română, frază scurtă');
select is(metrics.text_language_v1('Am luat Proenzi pentru genunchi si chiar ma ajuta, recomand'), 'ro', 'L1: română fără diacritice');
select is(metrics.text_language_v1('DISCONFORTUL ȘI RIGIDITATEA ÎȚI POT AFECTA ZIUA'), 'ro', 'L1: majusculele românești (lower() nu le schimbă în colația C)');
select is(metrics.text_language_v1('Rigiditatea articulară îţi poate afecta ziua; şi totuşi'), 'ro', 'L1: ş și ţ cu sedilă contează ca ș și ț');
select is(metrics.text_language_v1('¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.'), 'other', 'L1: spaniolă');
select is(metrics.text_language_v1('E sẵn 3 loại Proenzi xương khớp, khách mua làm quà ơi e nhé'), 'other', 'L1: vietnameză (are ă și â, dar și litere care nu există în română)');
select is(metrics.text_language_v1('حافظ على نشاطك اليومي واستمتع بحركة مرنة كل يوم. اكتشف Proenzi 3 Plus لدعم صحة المفاصل'), 'other', 'L1: arabă');
select is(metrics.text_language_v1('Eladóvá vált Proenzi Intenzív max 6 db hiányzik, Egyik doboz fel sincs bontva. Térdemre szedtem, csak mivel allergiáim vannak nem bírom sajnos!'), 'other', 'L1: maghiară');
select is(metrics.text_language_v1('This is the best supplement for your joints and I love it'), 'other', 'L1: engleză');
select is(metrics.text_language_v1('Proenzi ile eklemlerim çok daha iyi, herkese tavsiye ederim'), 'other', 'L1: turcă (ş nu o face română)');
select is(metrics.text_language_v1('Стада Проэнзи помогает суставам'), 'other', 'L1: chirilică');
select is(metrics.text_language_v1('Proenzi 👍'), null, 'L1: prea scurt: nedeterminată, nu „altă limbă”');
select is(metrics.text_language_v1('Am cumparat de la farmacie Catena, pret bun'), null, 'L1: fără semnal clar: nedeterminată (rămâne afișată)');
select is(metrics.text_language_v1(''), null, 'L1: text gol');
select is(metrics.text_language_v1(null), null, 'L1: fără text');
select ok((select provolatile = 'i' from pg_proc where oid = 'metrics.text_language_v1(text)'::regprocedure), 'L1: funcție pură (IMMUTABLE)');

-- L2. Regula de excludere: limba sursei are întâietate; nedeterminata nu se exclude ----------------------------------------------
select is(metrics.mention_other_language('ro', 'other'), false, 'L2: sursa spune ro: rămâne, orice ar arăta textul');
select is(metrics.mention_other_language('ron', null), false, 'L2: ron (ISO 639-2) e tot română');
select is(metrics.mention_other_language('hu', 'ro'), true, 'L2: sursa spune altă limbă: se exclude');
select is(metrics.mention_other_language(null, 'other'), true, 'L2: fără limba sursei, textul în altă limbă se exclude');
select is(metrics.mention_other_language(null, null), false, 'L2: nedeterminată: rămâne');
select is(metrics.mention_other_language(null, 'ro'), false, 'L2: română: rămâne');

-- Date: o conexiune Planable, apoi mențiuni în mai multe limbi ----------------------------------------------------------------
create temporary table ctx (k text primary key, v uuid) on commit drop;
grant all on ctx to public;
insert into public.source_connections (tenant_id, brand_id, provider, external_account_id)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'planable', 'ws-z');
insert into ctx select 'conn', id from public.source_connections where external_account_id = 'ws-z';
insert into public.sync_runs (tenant_id, brand_id, source_connection_id, source, period_start, period_end, status, rows_written, started_at, finished_at)
values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', (select v from ctx where k = 'conn'), 'planable_listening',
        current_date - 35, current_date - 1, 'succeeded', 8, now() - interval '1 minute', now());
insert into ctx select 'run', id from public.sync_runs where source_connection_id = (select v from ctx where k = 'conn');

create function pg_temp.mention(p_id text, p_text text, p_reviewed boolean default false, p_sentiment text default 'neutral', p_language text default null, p_owned boolean default false)
returns void language sql as $$
  insert into public.mentions (tenant_id, brand_id, native_id, url, source_name, published_at, text, sentiment, sentiment_reviewed_by, sentiment_reviewed_at, author_is_owned, language,
                               collected_at, collection_method, payload_hash, source_timezone, schema_version, source_id, sync_run_id)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', p_id, case when p_id like 'h:%' then 'https://x.test/' || p_id end, 'instagram',
          now() - interval '2 days', p_text, p_sentiment,
          case when p_reviewed then '30000000-0000-0000-0000-000000000001'::uuid end, case when p_reviewed then now() end, p_owned, p_language,
          now(), 'api', repeat('a', 64), 'Europe/Bucharest', 't', (select v from ctx where k = 'conn'), (select v from ctx where k = 'run'))
$$;
create function pg_temp.feed(p_language text default 'ro', p_sentiment text default null) returns jsonb language sql as $$
  select public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, p_sentiment, null, 1, 20, 'all', p_language)
$$;
create function pg_temp.dist(p_key text, p_language text default 'ro') returns integer language sql as $$
  select (public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, p_language) ->> p_key)::integer
$$;

select pg_temp.mention('h:ro-1', 'Disconfortul și rigiditatea articulară îți pot afecta ritmul de zi cu zi.', true, 'positive');
select pg_temp.mention('h:ro-2', 'Am luat Proenzi pentru genunchi si chiar ma ajuta, recomand');
select pg_temp.mention('h:scurt', 'Proenzi 👍');
select pg_temp.mention('h:es', '¿Remojas los frijoles, tiras el agua y aun así te inflan? No es tu panza: es una enzima que nadie fabrica.', true, 'negative');
select pg_temp.mention('h:hu', 'Eladóvá vált Proenzi Intenzív max 6 db hiányzik, Egyik doboz fel sincs bontva. Térdemre szedtem, csak mivel allergiáim vannak nem bírom sajnos!');
select pg_temp.mention('h:csv-ro', 'This text is English but the file says Romanian', false, 'neutral', 'ro');
select pg_temp.mention('h:proprie-ar', 'حافظ على نشاطك اليومي واستمتع بحركة مرنة كل يوم. اكتشف Proenzi 3 Plus لدعم صحة المفاصل', false, 'neutral', null, true);
select pg_temp.mention('s:web', null);

-- L3. Coloana generată ------------------------------------------------------------------------------------------------------------
select is((select language_detected from public.mentions where native_id = 'h:ro-1'), 'ro', 'L3: limba se calculează la scriere');
select is((select language_detected from public.mentions where native_id = 'h:hu'), 'other', 'L3: și pentru altă limbă');
select is((select language_detected from public.mentions where native_id = 's:web'), null, 'L3: fără text: NULL, nu o limbă presupusă');
update public.mentions set text = 'Rigiditatea articulară îți poate afecta ziua și somnul.' where native_id = 'h:hu';
select is((select language_detected from public.mentions where native_id = 'h:hu'), 'ro', 'L3: se recalculează când textul se schimbă (reimport)');
update public.mentions set text = 'Eladóvá vált Proenzi Intenzív max 6 db hiányzik, Egyik doboz fel sincs bontva. Térdemre szedtem, csak mivel allergiáim vannak nem bírom sajnos!' where native_id = 'h:hu';
select throws_ok($$ update public.mentions set language_detected = 'ro' where native_id = 'h:hu' $$, '428C9', null, 'L3: coloana nu se scrie direct');

-- L4. Feed-ul: implicit doar română (și nedeterminate); restul numărate --------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((pg_temp.feed() ->> 'total')::integer, 4, 'L4: ro-1, ro-2, scurt și csv-ro (sursa spune ro)');
select is((select array_agg(i ->> 'id' order by i ->> 'id') from jsonb_array_elements(pg_temp.feed() -> 'items') i), array['h:csv-ro', 'h:ro-1', 'h:ro-2', 'h:scurt'], 'L4: exact acestea, fără es, hu și ar');
select is((pg_temp.feed() ->> 'other_language')::integer, 3, 'L4: es, hu și postarea proprie în arabă sunt numărate ca altă limbă');
select is((pg_temp.feed() ->> 'without_content')::integer, 1, 'L4: cea fără conținut rămâne numărată separat');
select is((public.brand_mentions('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) ->> 'total')::integer, 4, 'L4: fără parametru, implicit română');
select is((pg_temp.feed('all') ->> 'total')::integer, 7, 'L4: p_language = all le arată pe toate cele cu conținut');
select is((pg_temp.feed('all') ->> 'other_language')::integer, 0, 'L4: și nu mai raportează excluse');
select is((pg_temp.feed('ro', 'negative') ->> 'total')::integer, 0, 'L4: negativa revizuită în spaniolă nu apare la filtrul de sentiment');
select is((pg_temp.feed('ro', 'negative') ->> 'other_language')::integer, 1, 'L4: dar e numărată, pe același filtru');
select throws_ok($$ select pg_temp.feed('hu') $$, '22023', null, 'L4: filtru de limbă necunoscut');

-- L5. Distribuția: doar mențiunile externe în română (sau nedeterminate) -----------------------------------------------------------
select is(pg_temp.dist('total'), 1, 'L5: doar ro-1 e revizuită și în română');
select is(pg_temp.dist('negative'), 0, 'L5: negativa în spaniolă nu intră în procente');
select is((public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date) -> 'shares' ->> 'positive')::numeric, 100::numeric, 'L5: procentele sunt doar din română');
select is(pg_temp.dist('unreviewed'), 3, 'L5: așteaptă revizuirea: ro-2, scurt, csv-ro (nu și hu)');
select is(pg_temp.dist('other_language'), 2, 'L5: es și hu numărate separat; postarea proprie e la owned_excluded');
select is(pg_temp.dist('owned_excluded'), 1, 'L5: conturile proprii, ca înainte');
select is(pg_temp.dist('without_content'), 1, 'L5: fără conținut, ca înainte');
select is(pg_temp.dist('total', 'all'), 2, 'L5: cu all, și negativa în spaniolă');
select is(pg_temp.dist('other_language', 'all'), 0, 'L5: cu all, nimic exclus pentru limbă');
select throws_ok($$ select public.brand_mention_sentiment('20000000-0000-0000-0000-000000000011', current_date - 7, current_date, 'xx') $$, '22023', null, 'L5: filtru de limbă necunoscut');

-- L6. Indicatorul „Mențiuni” (v2, deciziile AE) urmează aceeași regulă ---------------------------------------------------------
reset role;
select is((select sum(value)::integer from public.mentions_metric_observations where brand_id = '20000000-0000-0000-0000-000000000011' and date >= current_date - 7), 5, 'L6: mentions_count v2 (deciziile AE) nu numără es, hu și ar: 5 din 8');

-- L7. Izolare și regim E8 ---------------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.feed() $$, '42501', null, 'L7: alt client nu citește feed-ul');
select throws_ok($$ select pg_temp.dist('total') $$, '42501', null, 'L7: nici distribuția');
select tests.authenticate_as_anon();
select throws_ok($$ select pg_temp.feed() $$, '42501', null, 'L7: anon nu citește feed-ul');
reset role;
select ok(not has_function_privilege('anon', 'public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text)', 'execute'), 'L7: anon nu execută brand_mentions');
select ok(not has_function_privilege('anon', 'public.brand_mention_sentiment(uuid, date, date, text)', 'execute'), 'L7: anon nu execută brand_mention_sentiment');
select ok(not (select prosecdef from pg_proc where oid = 'public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text)'::regprocedure), 'L7: brand_mentions e SECURITY INVOKER');
select ok(not (select prosecdef from pg_proc where oid = 'public.brand_mention_sentiment(uuid, date, date, text)'::regprocedure), 'L7: brand_mention_sentiment e SECURITY INVOKER');
select is((select count(*)::integer from pg_proc where proname in ('brand_mentions', 'brand_mention_sentiment') and pronamespace = 'public'::regnamespace), 2, 'L7: semnăturile vechi nu au rămas ca supraîncărcări');

select * from finish();
rollback;
