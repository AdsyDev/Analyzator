-- Prima versiune a setului de competitori poate începe în trecut (cererea proprietarului produsului, 23 nov. 2026; decizia Z-1).
--
-- Comparația cu competitorii folosește setul în vigoare la sfârșitul perioadei. Cu data minimă „azi”, un set introdus
-- după lansare lăsa toate perioadele trecute fără comparație („Sursă neconectată”). Prima versiune nu rescrie nimic deja
-- văzut: înainte de ea nu exista nicio comparație. Versiunile următoare rămân de azi înainte. Limita de jos: 2020-01-01.
--
-- Se aplică pe definiția curentă a funcției (20261123090000_competitor_listening_ads, cu listening_keywords,
-- social_handles și ads_advertiser_ids), schimbând doar verificarea datei: restul (acces, validări, atomicitate, audit)
-- rămâne neschimbat. Verificarea nouă stă după lock-ul advisory, ca două „prime versiuni” concurente să nu treacă amândouă
-- drept „prima”. Semnătura, SECURITY INVOKER și drepturile (E4) rămân aceleași.

do $$
declare
  v_def text;
  v_old constant text := $t$  if p_effective_from < v_today then
    raise exception 'Data de la care se aplică versiunea nu poate fi în trecut (azi este %, Europe/Bucharest)',
      to_char(v_today, 'YYYY-MM-DD') using errcode = '22023';
  end if;
$t$;
  v_lock constant text := $t$  perform pg_advisory_xact_lock(hashtextextended('competitor_set_version:' || p_brand_id::text, 0));
$t$;
  v_new constant text := $t$
  -- Prima versiune a brandului poate începe în trecut (Z-1); versiunile următoare, de azi înainte. După lock:
  -- două prime versiuni concurente nu pot începe amândouă în trecut.
  if p_effective_from < v_today and exists (
    select 1 from public.competitor_sets cs where cs.tenant_id = v_tenant_id and cs.brand_id = p_brand_id
  ) then
    raise exception 'Data de la care se aplică versiunea nu poate fi în trecut (azi este %, Europe/Bucharest); doar prima versiune a setului poate începe în trecut',
      to_char(v_today, 'YYYY-MM-DD') using errcode = '22023';
  end if;
  if p_effective_from < date '2020-01-01' then
    raise exception 'Data de la care se aplică versiunea nu poate fi înainte de 2020-01-01' using errcode = '22023';
  end if;
$t$;
begin
  v_def := pg_get_functiondef('public.create_competitor_set_version(uuid, date, text, jsonb)'::regprocedure);
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'create_competitor_set_version nu mai are verificarea așteptată a datei';
  end if;
  if (length(v_def) - length(replace(v_def, v_lock, ''))) / length(v_lock) <> 1 then
    raise exception 'create_competitor_set_version nu mai are lock-ul advisory așteptat';
  end if;
  v_def := replace(v_def, v_old, '');
  v_def := replace(v_def, v_lock, v_lock || v_new);
  execute v_def;
end;
$$;

comment on function public.create_competitor_set_version(uuid, date, text, jsonb) is
  'Creează atomic o versiune nouă a setului de competitori (set + membri, cu identificatorii Listening, Competitors și Ads Transparency). Prima versiune poate începe în trecut, următoarele nu. SECURITY INVOKER: RLS rămâne autoritatea. Vezi docs/security-tests.md, E4.';
