-- „Mențiuni” doar în română: versiunea 2 a `mentions_count` (deciziile AD din docs/decisions.md, cererea din 24 nov. 2026).
--
-- Versiunea 1 numără toate mențiunile publicate în interval, în orice limbă. Versiunea 2 nu le mai numără pe cele clar în
-- altă limbă decât româna, cu aceeași regulă ca feed-ul și distribuția din Listening (deciziile AC):
-- `metrics.mention_other_language(language, language_detected)`. Rămân numărate mențiunile în română, cele cu limba
-- nedeterminată (text prea scurt) și cele fără text (mențiunile web din Planable): limba lor nu se poate stabili, iar
-- regula 8 nu permite să le presupunem străine.
--
-- Ca la H-2: aceeași cheie, versiune nouă cu `valid_from`, iar view-ul de observații se înlocuiește. Versiunea 1 rămâne în
-- registru ca istoric (registrul e imutabil); analizele publicate își păstrează instantaneul cu versiunea 1.
--
-- Matricea de Concurență: limba mențiunilor competitorilor nu se poate stabili (textul lor nu se păstrează, Y-5). Ca
-- „Mențiuni” și „Share of voice (mențiuni)” să compare același lucru, celula brandului numără acolo toate limbile, cu
-- starea și acoperirea din registru și cu motivul scris în celulă.

-- 1. Registrul ---------------------------------------------------------------------------------------------------------------

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('mentions_count', 2, 'Mențiuni (Planable Listening)', 'Numărul de mențiuni distincte publicate în interval, fără cele clar în altă limbă decât româna (limba declarată de sursă sau, fără ea, stabilită din text). Mențiunile cu limba nedeterminată și cele fără text se numără; importul nu schimbă data publicării.', 'count', 'planable_listening', 'sum', 1, null,
   null, 'neutral', null, 14, 'active', null, '2026-11-24', 'docs/metrics/registry-b.md#mentions_count');

-- Garda: versiunea 2 diferă de versiunea 1 doar prin formulă, versiune și valid_from.
do $$
declare
  v_diff integer;
begin
  select count(*) into v_diff
  from public.metric_definitions v1
  join public.metric_definitions v2 on v2.metric_key = v1.metric_key and v2.version = 2
  where v1.version = 1 and v1.metric_key = 'mentions_count'
    and (v1.name_ro, v1.unit, v1.primary_source, v1.aggregation, v1.multiplier, v1.weight_basis, v1.aggregation_label,
         v1.direction, v1.min_sample, v1.freshness_grace_days, v1.lifecycle, v1.lifecycle_note, v1.doc_ref)
        is distinct from
        (v2.name_ro, v2.unit, v2.primary_source, v2.aggregation, v2.multiplier, v2.weight_basis, v2.aggregation_label,
         v2.direction, v2.min_sample, v2.freshness_grace_days, v2.lifecycle, v2.lifecycle_note, v2.doc_ref);
  if v_diff <> 0 then
    raise exception 'Versiunea 2 a mentions_count diferă de versiunea 1 și prin altceva decât formula';
  end if;
end;
$$;

-- 2. Observațiile ------------------------------------------------------------------------------------------------------------

-- Aceleași coloane; se schimbă doar ce mențiuni intră. O zi în care toate mențiunile sunt în altă limbă nu are rând, ca o zi
-- fără mențiuni (registrul nu o confirmă ca zero; acoperirea rămâne „parțial”, ca până acum).
create or replace view public.mentions_metric_observations
with (security_invoker = true) as
select tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date as date,
       'mentions_count'::text as metric_key, count(*)::numeric as value, max(collected_at) as collected_at
from public.mentions
where not metrics.mention_other_language(language, language_detected)
group by tenant_id, brand_id, (published_at at time zone 'Europe/Bucharest')::date;

comment on view public.mentions_metric_observations is
  'Observațiile mentions_count (v2, deciziile AD): mențiuni distincte pe zi (data publicării, Europe/Bucharest), fără cele clar în altă limbă decât româna.';

-- 3. Matricea de Concurență: brandul pe aceeași bază ca competitorii ------------------------------------------------------------

do $$
declare
  v_def text;
  v_old constant text := $q$  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');$q$;
  v_new constant text := $q$  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');
  -- Deciziile AD: limba mențiunilor competitorilor nu se poate stabili (Y-5), deci brandul se numără aici în toate limbile.
  -- Starea și acoperirea rămân cele din registru; doar valoarea e pe aceeași bază ca a competitorilor.
  if jsonb_typeof(v_listen -> 'value') = 'number' then
    v_listen := v_listen || jsonb_build_object(
      'value', (select count(*)::numeric from public.mentions mm
                where mm.tenant_id = v_brand.tenant_id and mm.brand_id = p_brand_id
                  and mm.published_at >= (p_start::timestamp at time zone 'Europe/Bucharest')
                  and mm.published_at < ((p_end + 1)::timestamp at time zone 'Europe/Bucharest')),
      'reason', concat_ws(' ', nullif(v_listen ->> 'reason', ''),
        'Toate limbile, ca la competitori (limba mențiunilor lor nu se cunoaște); indicatorul „Mențiuni” din Overview numără doar româna.'));
  end if;$q$;
begin
  select pg_get_functiondef('public.brand_competition(uuid, date, date, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'brand_competition nu mai are celula Listening așteptată';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
