-- Corecție (12 oct 2026, găsită pe app.analyzator.ro): o metrică fără sursă de observații (cheie încă neînregistrată, de ex.
-- `paid_spend` pe Overview) are `source` null; `meta.sources` o includea ca null, iar contractul cere doar text, așa că
-- UI-ul respingea tot răspunsul (toate cardurile ecranului). Sursele nule nu intră în listă; metrica rămâne `not_connected`.

create or replace function metrics.build_response(p_context jsonb, p_items jsonb)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'data', coalesce((select jsonb_agg(jsonb_build_object('metric_key', i ->> 'metric_key') || (i -> 'metric')
                                       order by ord)
                      from jsonb_array_elements(p_items) with ordinality as t (i, ord)), '[]'::jsonb),
    'meta', jsonb_build_object(
      'tenant_id', p_context ->> 'tenant_id',
      'brand_id', p_context ->> 'brand_id',
      'period', p_context -> 'period',
      'comparison_period', p_context -> 'comparison_period',
      'data_as_of', (select min((i -> 'metric' ->> 'data_as_of')::date) from jsonb_array_elements(p_items) i),
      'generated_at', now(),
      'sources', coalesce((select jsonb_agg(distinct i ->> 'source') from jsonb_array_elements(p_items) i where i ->> 'source' is not null), '[]'::jsonb),
      'coverage', (select min((i -> 'metric' ->> 'coverage')::numeric) from jsonb_array_elements(p_items) i),
      'cohort_version', p_context -> 'cohort_version',
      'metric_definition_version', coalesce((select jsonb_object_agg(i ->> 'metric_key', (i ->> 'metric_definition_version')::integer)
                                             from jsonb_array_elements(p_items) i), '{}'::jsonb),
      'warnings', coalesce((select jsonb_agg(w) from jsonb_array_elements(p_items) i,
                                                   jsonb_array_elements(i -> 'warnings') w), '[]'::jsonb)
    )
  );
$$;
