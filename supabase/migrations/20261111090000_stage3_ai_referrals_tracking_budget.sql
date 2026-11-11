-- Etapa 3 din propunerea „Specificația dashboardurilor pentru clienți”, prima felie (deciziile J din docs/decisions.md):
-- datele din spatele a trei secțiuni care aveau interfață, dar nu aveau sursă.
--
-- 1. AI referrals: reguli de clasificare versionate (funcții pure în `metrics`) și `brand_ai_referrals`.
-- 2. Calitatea trackingului: `brand_tracking_quality`, verificări calculate din datele GA4 deja colectate.
-- 3. Buget și pacing: tabelul `paid_budgets` (scris de agenție) și `brand_paid_budget`.
--
-- Toate RPC-urile urmează regimul E8: SECURITY INVOKER, verifică `has_brand_access` în corp, citesc prin RLS.

-- 1. AI referrals -------------------------------------------------------------------------------------------------------

-- Regulile, versiunea 1. `kind = 'domain'`: sursa sesiunii e domeniul sau un subdomeniu al lui. `kind = 'source'`: sursa e
-- exact acest text (utm_source fără domeniu). Lista se schimbă doar printr-o versiune nouă, cu dată de intrare în vigoare.
create function metrics.ai_referral_rule_list()
returns table (kind text, pattern text, domain text)
language sql
immutable
set search_path = ''
as $$
  values
    ('domain', 'chatgpt.com', 'chatgpt.com'),
    ('domain', 'chat.openai.com', 'chatgpt.com'),
    ('domain', 'perplexity.ai', 'perplexity.ai'),
    ('domain', 'gemini.google.com', 'gemini.google.com'),
    ('domain', 'bard.google.com', 'gemini.google.com'),
    ('domain', 'copilot.microsoft.com', 'copilot.microsoft.com'),
    ('domain', 'claude.ai', 'claude.ai'),
    ('domain', 'chat.deepseek.com', 'chat.deepseek.com'),
    ('domain', 'meta.ai', 'meta.ai'),
    ('domain', 'grok.com', 'grok.com'),
    ('domain', 'chat.mistral.ai', 'chat.mistral.ai'),
    ('domain', 'you.com', 'you.com'),
    ('domain', 'poe.com', 'poe.com'),
    ('source', 'chatgpt', 'chatgpt.com'),
    ('source', 'perplexity', 'perplexity.ai'),
    ('source', 'gemini', 'gemini.google.com'),
    ('source', 'copilot', 'copilot.microsoft.com'),
    ('source', 'claude', 'claude.ai');
$$;

create function metrics.ai_referral_rules()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('version', 'v1', 'effective_from', '2026-11-11'::date);
$$;

-- Asistentul AI din care vine o sesiune, după `sessionSourceMedium` din GA4 („sursă / medium”); NULL = nu e o sursă AI
-- cunoscută. Traficul din Google AI Overviews și AI Mode nu se poate deosebi: vine ca „google / organic”.
create function metrics.ai_referral_domain(p_source_medium text)
returns text
language sql
immutable
set search_path = ''
as $$
  select r.domain
  from (select lower(trim(split_part(coalesce(p_source_medium, ''), ' / ', 1))) as source) s
  join metrics.ai_referral_rule_list() r
    on (r.kind = 'domain' and (s.source = r.pattern or s.source like '%.' || r.pattern))
    or (r.kind = 'source' and s.source = r.pattern)
  order by length(r.pattern) desc
  limit 1;
$$;

create function public.brand_ai_referrals(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_rules jsonb := metrics.ai_referral_rules();
  v_has_key_events boolean;
  v_out jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'ga4') then
    return jsonb_build_object('connected', false);
  end if;
  -- Aceeași regulă ca la canale: key events apar doar dacă raportul de evenimente cheie are date în perioadă (regula 8).
  v_has_key_events := exists (select 1 from public.web_key_events
                              where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end and key_events is not null);

  select coalesce(jsonb_agg(jsonb_build_object(
      'domain', a.domain, 'sessions', a.sessions,
      'key_events', case when v_has_key_events then a.key_events end,
      -- Rata nu se calculează: „rata sesiunilor cu key event” nu are definiție în registru (G-1), iar
      -- evenimente / sesiuni nu e acea rată.
      'conversion_rate', null) order by a.sessions desc nulls last, a.domain), '[]'::jsonb)
    into v_out
  from (
    select metrics.ai_referral_domain(source_medium) as domain, sum(sessions) as sessions,
           case when count(key_events) > 0 then sum(key_events) end as key_events
    from public.web_daily
    where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end
      and metrics.ai_referral_domain(source_medium) is not null
    group by 1
  ) a;

  return jsonb_build_object('connected', true, 'sources', v_out,
    'rules_version', v_rules ->> 'version', 'rules_effective_from', v_rules ->> 'effective_from',
    'data_as_of', (select max(date) from public.web_daily where brand_id = p_brand_id and window_days = 1 and sessions is not null));
end;
$$;

revoke all on function public.brand_ai_referrals(uuid, date, date) from public, anon;
grant execute on function public.brand_ai_referrals(uuid, date, date) to authenticated, service_role;
comment on function public.brand_ai_referrals(uuid, date, date) is
  'Sesiunile GA4 venite din asistenți AI, pe domeniu, după regulile versionate din metrics.ai_referral_rule_list. SECURITY INVOKER; verifică has_brand_access (E8).';

-- 2. Calitatea trackingului -----------------------------------------------------------------------------------------------

-- Pragurile verificărilor, provizorii (J-3): cota de sesiuni „Unassigned” și cota fără landing page de la care apare avertismentul.
create function metrics.tracking_thresholds()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('unassigned_warning_pct', 10, 'landing_not_set_warning_pct', 10);
$$;

create function public.brand_tracking_quality(p_brand_id uuid, p_start date, p_end date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_thresholds jsonb := metrics.tracking_thresholds();
  v_checked_at timestamptz;
  v_data_as_of date;
  v_last date;
  v_expected integer;
  v_covered integer;
  v_total numeric;
  v_unassigned numeric;
  v_not_set numeric;
  v_events integer;
  v_rec record;
  v_checks jsonb := '[]'::jsonb;
  v_share numeric;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if not private.brand_source_connected(p_brand_id, 'ga4') then
    return jsonb_build_object('connected', false);
  end if;

  select max(collected_at), max(date) filter (where sessions is not null) into v_checked_at, v_data_as_of
  from public.web_daily where brand_id = p_brand_id and window_days = 1;
  if v_checked_at is null then
    return jsonb_build_object('connected', true, 'checked_at', null, 'checks', '[]'::jsonb);
  end if;

  -- Evenimente cheie: fără ele, conversiile din GA4 nu pot fi măsurate.
  select count(distinct event_name) into v_events
  from public.web_key_events
  where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end and key_events > 0;
  v_checks := v_checks || jsonb_build_object('id', 'key_events', 'status', case when v_events > 0 then 'ok' else 'warning' end, 'event_names', v_events);

  -- Zile cu sesiuni: se numără doar zilele deja colectate (până la ultima zi cu date), nu cele încă neimportate.
  v_last := least(p_end, v_data_as_of);
  v_expected := case when v_last is null or v_last < p_start then 0 else v_last - p_start + 1 end;
  select count(distinct date) into v_covered
  from public.web_daily
  where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end and sessions is not null;
  v_checks := v_checks || jsonb_build_object('id', 'daily_coverage',
    'status', case when v_expected = 0 then 'unknown' when v_covered = 0 then 'problem' when v_covered < v_expected then 'warning' else 'ok' end,
    'covered_days', v_covered, 'expected_days', v_expected);

  -- Reconcilierea cu totalul raportat de GA4: cea mai recentă verificare a sesiunilor care atinge perioada.
  select r.status, r.difference_pct, r.tolerance_pct, r.period_start, r.period_end into v_rec
  from public.source_reconciliations r
  where r.brand_id = p_brand_id and r.source = 'ga4' and r.metric = 'sessions'
    and r.period_end >= p_start and r.period_start <= p_end
  order by r.checked_at desc limit 1;
  v_checks := v_checks || jsonb_build_object('id', 'reconciliation',
    'status', case when v_rec.status in ('match', 'within_tolerance') then 'ok' when v_rec.status = 'mismatch' then 'warning' else 'unknown' end,
    'difference_pct', v_rec.difference_pct, 'tolerance_pct', v_rec.tolerance_pct,
    'period_start', v_rec.period_start, 'period_end', v_rec.period_end);

  select sum(sessions), sum(sessions) filter (where lower(channel_group) = 'unassigned'), sum(sessions) filter (where landing_page = '(not set)')
    into v_total, v_unassigned, v_not_set
  from public.web_daily where brand_id = p_brand_id and window_days = 1 and date between p_start and p_end;

  -- Trafic fără canal: de obicei linkuri fără UTM corect sau surse pe care GA4 nu le poate încadra.
  v_share := metrics.ratio(coalesce(v_unassigned, 0), v_total, 100);
  v_checks := v_checks || jsonb_build_object('id', 'unassigned',
    'status', case when v_share is null then 'unknown' when v_share >= (v_thresholds ->> 'unassigned_warning_pct')::numeric then 'warning' else 'ok' end,
    'share_pct', v_share, 'threshold_pct', (v_thresholds ->> 'unassigned_warning_pct')::numeric);

  -- Sesiuni fără landing page: sesiuni în care GA4 nu a primit nicio afișare de pagină.
  v_share := metrics.ratio(coalesce(v_not_set, 0), v_total, 100);
  v_checks := v_checks || jsonb_build_object('id', 'landing_not_set',
    'status', case when v_share is null then 'unknown' when v_share >= (v_thresholds ->> 'landing_not_set_warning_pct')::numeric then 'warning' else 'ok' end,
    'share_pct', v_share, 'threshold_pct', (v_thresholds ->> 'landing_not_set_warning_pct')::numeric);

  return jsonb_build_object('connected', true, 'checked_at', v_checked_at, 'checks', v_checks);
end;
$$;

revoke all on function public.brand_tracking_quality(uuid, date, date) from public, anon;
grant execute on function public.brand_tracking_quality(uuid, date, date) to authenticated, service_role;
comment on function public.brand_tracking_quality(uuid, date, date) is
  'Verificări de calitate a măsurării GA4, din datele deja colectate: evenimente cheie, zile cu sesiuni, reconciliere, trafic neîncadrat. SECURITY INVOKER; verifică has_brand_access (E8).';

-- 3. Buget și pacing --------------------------------------------------------------------------------------------------------

create table public.paid_budgets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null,
  brand_id    uuid not null,
  plan_from   date not null,
  plan_to     date not null,
  amount      numeric not null check (amount > 0),
  currency    char(3) not null check (currency ~ '^[A-Z]{3}$'),
  note        text check (note is null or length(trim(note)) between 1 and 200),
  created_by  uuid not null,
  created_at  timestamptz not null default now(),
  check (plan_to >= plan_from and plan_to - plan_from <= 400),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.paid_budgets is
  'Bugetul de paid media aprobat pe un interval, pentru toate platformele brandului, introdus de agenție. Rândurile nu se '
  'modifică: un plan greșit se șterge și se introduce din nou. Pentru o zi, e în vigoare planul introdus cel mai recent.';
create index paid_budgets_brand_idx on public.paid_budgets (tenant_id, brand_id, plan_from);

alter table public.paid_budgets enable row level security;
revoke all on public.paid_budgets from public, anon, authenticated;
grant select, delete on public.paid_budgets to authenticated;
grant insert (tenant_id, brand_id, plan_from, plan_to, amount, currency, note, created_by) on public.paid_budgets to authenticated;
grant all on public.paid_budgets to service_role;

-- Clientul vede bugetul aprobat al brandului lui; îl scrie doar echipa agenției cu acces la brand.
-- Citirea folosește accessible_brand_ids() (o dată pe interogare, E9), ca restul tabelelor de date.
create policy paid_budgets_select on public.paid_budgets for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy paid_budgets_insert on public.paid_budgets for insert to authenticated
  with check (
    private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[])
    and created_by = (select auth.uid())
  );
create policy paid_budgets_update on public.paid_budgets for update to authenticated
  using (false);
create policy paid_budgets_delete on public.paid_budgets for delete to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin', 'strategist', 'account']::public.membership_role[]));

create trigger paid_budgets_audit after insert or delete on public.paid_budgets
  for each row execute function private.audit_row();

create function public.brand_paid_budget(p_brand_id uuid, p_day date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_plan record;
  v_spend record;
  v_planned integer;
  v_elapsed integer;
  v_spent numeric;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_day is null then
    raise exception 'Zi invalidă' using errcode = '22023';
  end if;

  -- Planul în vigoare în ziua cerută; la suprapunere, cel introdus cel mai recent.
  select b.id, b.plan_from, b.plan_to, b.amount, b.currency, b.note into v_plan
  from public.paid_budgets b
  where b.brand_id = p_brand_id and p_day between b.plan_from and b.plan_to
  order by b.created_at desc, b.id limit 1;
  if v_plan.id is null then
    return jsonb_build_object('plan', null);
  end if;

  -- Costul din plan, doar rândurile fără defalcare (ca în brand_paid). Monede diferite de a planului nu se adună.
  select sum(spend) as spend, max(date) as data_as_of,
         count(distinct currency) as currencies, min(currency) as currency
    into v_spend
  from public.paid_daily
  where brand_id = p_brand_id and breakdown_signature = 'none' and spend is not null
    and date between v_plan.plan_from and v_plan.plan_to;

  v_planned := v_plan.plan_to - v_plan.plan_from + 1;
  -- Zilele trecute se numără până la ultima zi cu date, ca să se compare cu costul adunat până în aceeași zi.
  v_elapsed := case when v_spend.data_as_of is null then 0 else v_spend.data_as_of - v_plan.plan_from + 1 end;
  v_spent := case when v_spend.currencies = 1 and v_spend.currency = v_plan.currency then v_spend.spend end;

  return jsonb_build_object('plan', jsonb_build_object(
    'id', v_plan.id, 'plan_from', v_plan.plan_from, 'plan_to', v_plan.plan_to,
    'approved_budget', v_plan.amount, 'currency', v_plan.currency, 'plan_note', v_plan.note,
    'spent', v_spent,
    'currency_mismatch', coalesce(v_spend.currencies, 0) > 1 or (v_spend.currencies = 1 and v_spend.currency <> v_plan.currency),
    'data_as_of', v_spend.data_as_of,
    'elapsed_days', v_elapsed, 'planned_days', v_planned,
    'spend_pct', metrics.ratio(v_spent, v_plan.amount, 100),
    'time_pct', metrics.ratio(v_elapsed, v_planned, 100)));
end;
$$;

revoke all on function public.brand_paid_budget(uuid, date) from public, anon;
grant execute on function public.brand_paid_budget(uuid, date) to authenticated, service_role;
comment on function public.brand_paid_budget(uuid, date) is
  'Planul de buget în vigoare într-o zi și progresul lui: cost adunat și zile trecute până la ultima zi cu date. SECURITY INVOKER; verifică has_brand_access (E8).';

-- Funcțiile noi din `metrics` primesc aceleași drepturi ca restul schemei.
revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;
