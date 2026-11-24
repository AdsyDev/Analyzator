-- AA: toleranța de prospețime a metricilor GA4 și Search Console, potrivită cu colectarea săptămânală.
--
-- Colectarea Google rulează marțea (google-weekly, cron `0 4 * * 2`). GA4 aduce date până ieri; Search Console până
-- cu 2 zile înainte de ieri (GSC_FINAL_LAG_DAYS, D-25). Între două rulări, ultima zi cu date ajunge astfel la
-- 8 zile în urma lui „ieri" la GA4 și la 9 zile la Search Console (lunea dinaintea rulării, și marți până la rulare).
-- Cu toleranțele vechi (GA4 2, GSC 3), metricile apăreau „stale" de joi până luni, deși nicio rulare nu lipsea.
--
-- Versiunea 2: aceeași formulă, unitate, agregare și direcție; doar `freshness_grace_days` se schimbă
-- (GA4 8 = 7 zile de cadență + 1 zi de rezervă; GSC 10 = 7 + 2 zile de întârziere finală + 1 zi de rezervă).
-- O rulare de marți ratată (sau întârziată peste miercuri) apare tot ca „stale", de joi. Versiunile 1 rămân ca istoric
-- (registrul e imutabil); analizele publicate își păstrează versiunea din instantaneu.
-- `source_status` și `source_freshness` iau maximul toleranței pe sursă din registru, deci se aliniază automat.
-- Decizia: docs/decisions.md, AA. Registrul: docs/metrics/registry.md.

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('ga4_sessions', 2, 'Sesiuni', 'Numărul de sesiuni GA4 în perioadă; suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 8, 'active', null, '2026-11-23', 'docs/metrics/registry.md#ga4_sessions'),
  ('ga4_active_users', 2, 'Utilizatori activi', 'Utilizatori activi GA4 din raportul pe intervalul întreg; zilele nu se însumează. Fără raport pe interval, valoarea e indisponibilă.', 'count', 'ga4', 'interval_report_only', 1, null,
   null, 'higher_is_better', null, 8, 'active', null, '2026-11-23', 'docs/metrics/registry.md#ga4_active_users'),
  ('ga4_engaged_sessions', 2, 'Sesiuni cu implicare', 'Numărul de sesiuni GA4 cu implicare (engaged sessions); suma zilelor.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 8, 'active', null, '2026-11-23', 'docs/metrics/registry.md#ga4_engaged_sessions'),
  ('ga4_key_events', 2, 'Key events', 'Numărul de key events GA4 în perioadă; suma zilelor. Separat de conversiile platformelor de ads.', 'count', 'ga4', 'sum', 1, null,
   null, 'higher_is_better', null, 8, 'active', null, '2026-11-23', 'docs/metrics/registry.md#ga4_key_events'),
  ('gsc_clicks', 2, 'Clicks (Search Console)', 'Clicks din rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 10, 'active', null, '2026-11-23', 'docs/metrics/registry.md#gsc_clicks'),
  ('gsc_impressions', 2, 'Impressions (Search Console)', 'Afișări în rezultatele Google Search; suma zilelor.', 'count', 'gsc', 'sum', 1, null,
   null, 'higher_is_better', null, 10, 'active', null, '2026-11-23', 'docs/metrics/registry.md#gsc_impressions'),
  ('gsc_ctr', 2, 'CTR (Search Console)', '100 × clicks / impressions, recalculat din totalurile perioadei, nu media ratelor zilnice.', 'percent', 'gsc', 'ratio', 100, null,
   null, 'higher_is_better', null, 10, 'active', null, '2026-11-23', 'docs/metrics/registry.md#gsc_ctr'),
  ('gsc_average_position', 2, 'Poziție medie (Search Console)', 'Poziția medie GSC, ponderată cu impressions. Nu este rankul SEOmonitor.', 'position', 'gsc', 'weighted_mean', 1, 'impressions',
   null, 'lower_is_better', null, 10, 'active', null, '2026-11-23', 'docs/metrics/registry.md#gsc_average_position');

-- Garda: versiunea 2 diferă de versiunea 1 doar prin toleranță, versiune și valid_from.
do $$
declare
  v_diff integer;
begin
  select count(*) into v_diff
  from public.metric_definitions v1
  join public.metric_definitions v2 on v2.metric_key = v1.metric_key and v2.version = 2
  where v1.version = 1
    and v1.metric_key in ('ga4_sessions', 'ga4_active_users', 'ga4_engaged_sessions', 'ga4_key_events',
                          'gsc_clicks', 'gsc_impressions', 'gsc_ctr', 'gsc_average_position')
    and (v1.name_ro, v1.formula_ro, v1.unit, v1.primary_source, v1.aggregation, v1.multiplier, v1.weight_basis,
         v1.aggregation_label, v1.direction, v1.min_sample, v1.lifecycle, v1.lifecycle_note, v1.doc_ref)
        is distinct from
        (v2.name_ro, v2.formula_ro, v2.unit, v2.primary_source, v2.aggregation, v2.multiplier, v2.weight_basis,
         v2.aggregation_label, v2.direction, v2.min_sample, v2.lifecycle, v2.lifecycle_note, v2.doc_ref);
  if v_diff <> 0 then
    raise exception 'Versiunea 2 a % metrici Google diferă de versiunea 1 și prin altceva decât toleranța', v_diff;
  end if;
end;
$$;
