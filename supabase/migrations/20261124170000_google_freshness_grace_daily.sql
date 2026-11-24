-- AF: colectarea zilnică a conectorilor API; toleranța de prospețime GA4 și Search Console potrivită cu ea.
--
-- Conectorii API (SEOmonitor, GA4, Search Console, Planable, Google Ads, Meta, TikTok) rulează zilnic la 03:17 UTC, nu
-- doar marțea (`.github/workflows/*-daily.yml`). Toleranțele din AA (GA4 8, GSC 10) erau gândite pentru 7 zile între
-- rulări; cu ele, o colectare zilnică ratată nu s-ar vedea o săptămână.
--
-- Versiunea 3: aceeași formulă, unitate, agregare și direcție ca versiunea 2; doar `freshness_grace_days` se schimbă.
--   GA4 2: după rulare, datele sunt până ieri; înainte de rularea de a doua zi, până alaltăieri (1 zi) + 1 zi de rezervă.
--   GSC 5: fereastra se termină cu 2 zile înainte de ieri, în fusul Pacific (GSC_FINAL_LAG_DAYS, D-25). La 03:17 UTC e încă
--   ziua precedentă în Pacific, deci după rulare datele sunt până azi − 4 (zile românești), iar înainte de rularea următoare
--   până azi − 5: 4 zile + 1 zi de rezervă.
-- O singură zi ratată nu face metricile „stale"; două zile la rând, da.
--
-- `source_status` și `source_freshness` luau maximul toleranței din TOATE versiunile metricilor sursei, deci ar fi rămas
-- la 8 și 10 zile. Acum citesc versiunea curentă (`metric_definitions_current`). Corpul view-urilor se schimbă printr-o
-- înlocuire exactă, ca în `20261124090000`: migrația se oprește dacă textul așteptat nu apare de exact două ori.
-- Decizia: docs/decisions.md, AF. Registrul: docs/metrics/registry.md.

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('ga4_sessions', 3, 'Sesiuni', 'Numărul de sesiuni GA4 în perioadă; suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-11-24', 'docs/metrics/registry.md#ga4_sessions'),
  ('ga4_active_users', 3, 'Utilizatori activi', 'Utilizatori activi GA4 din raportul pe intervalul întreg; zilele nu se însumează. Fără raport pe interval, valoarea e indisponibilă.', 'count', 'ga4', 'interval_report_only', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-11-24', 'docs/metrics/registry.md#ga4_active_users'),
  ('ga4_engaged_sessions', 3, 'Sesiuni cu implicare', 'Numărul de sesiuni GA4 cu implicare (engaged sessions); suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-11-24', 'docs/metrics/registry.md#ga4_engaged_sessions'),
  ('ga4_key_events', 3, 'Key events', 'Numărul de key events GA4 în perioadă; suma zilelor. Separat de conversiile platformelor de ads.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 2, 'active', null, '2026-11-24', 'docs/metrics/registry.md#ga4_key_events'),
  ('gsc_clicks', 3, 'Clicks (Search Console)', 'Clicks din rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 5, 'active', null, '2026-11-24', 'docs/metrics/registry.md#gsc_clicks'),
  ('gsc_impressions', 3, 'Impressions (Search Console)', 'Afișări în rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 5, 'active', null, '2026-11-24', 'docs/metrics/registry.md#gsc_impressions'),
  ('gsc_ctr', 3, 'CTR (Search Console)', '100 × clicks / impressions, recalculat din totalurile perioadei, nu media ratelor zilnice.', 'percent', 'gsc', 'ratio', 100, null,
   null, 'higher_is_better', null, 5, 'active', null, '2026-11-24', 'docs/metrics/registry.md#gsc_ctr'),
  ('gsc_average_position', 3, 'Poziție medie (Search Console)', 'Poziția medie GSC, ponderată cu impressions. Nu este rankul SEOmonitor.', 'position', 'gsc', 'weighted_mean', 1, 'impressions',
   null, 'lower_is_better', null, 5, 'active', null, '2026-11-24', 'docs/metrics/registry.md#gsc_average_position');

-- Garda: versiunea 3 diferă de versiunea 2 doar prin toleranță, versiune și valid_from.
do $$
declare
  v_diff integer;
  v_count integer;
begin
  select count(*) into v_count from public.metric_definitions v3
  join public.metric_definitions v2 on v2.metric_key = v3.metric_key and v2.version = 2
  where v3.version = 3
    and v3.metric_key in ('ga4_sessions', 'ga4_active_users', 'ga4_engaged_sessions', 'ga4_key_events',
                          'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position');
  if v_count <> 8 then
    raise exception 'AF: așteptam 8 definiții Google în versiunea 3, cu versiunea 2 înainte; am găsit %', v_count;
  end if;
  select count(*) into v_diff
  from public.metric_definitions v2
  join public.metric_definitions v3 on v3.metric_key = v2.metric_key and v3.version = 3
  where v2.version = 2
    and v2.metric_key in ('ga4_sessions', 'ga4_active_users', 'ga4_engaged_sessions', 'ga4_key_events',
                          'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position')
    and (v2.name_ro, v2.formula_ro, v2.unit, v2.primary_source, v2.aggregation, v2.multiplier, v2.weight_basis,
         v2.aggregation_label, v2.direction, v2.min_sample, v2.lifecycle, v2.lifecycle_note, v2.doc_ref)
        is distinct from
        (v3.name_ro, v3.formula_ro, v3.unit, v3.primary_source, v3.aggregation, v3.multiplier, v3.weight_basis,
         v3.aggregation_label, v3.direction, v3.min_sample, v3.lifecycle, v3.lifecycle_note, v3.doc_ref);
  if v_diff <> 0 then
    raise exception 'AF: versiunea 3 a % metrici Google diferă de versiunea 2 și prin altceva decât toleranța', v_diff;
  end if;
end;
$$;

-- Prospețimea sursei: toleranța versiunii curente a metricilor, nu maximul tuturor versiunilor.
do $$
declare
  v_view text;
  v_def text;
  v_found integer;
begin
  foreach v_view in array array['source_status', 'source_freshness'] loop
    v_def := pg_get_viewdef(format('public.%I', v_view)::regclass);
    select count(*) into v_found from regexp_matches(v_def, '(public\.)?metric_definitions m\M', 'g');
    if v_found <> 2 then
      raise exception 'AF: în %, „metric_definitions m" apare de % ori (așteptam 2)', v_view, v_found;
    end if;
    v_def := regexp_replace(v_def, '(public\.)?metric_definitions m\M', 'public.metric_definitions_current m', 'g');
    execute format('create or replace view public.%I with (security_invoker = true) as %s', v_view, rtrim(v_def, E'; \n'));
  end loop;
end;
$$;
