-- Restul Etapei 2 din propunerea din 10 nov. 2026 (deciziile H din docs/decisions.md).
--
-- 1. Comparația cu anul trecut: tipul de perioadă `yoy` (același interval, cu un an înainte) în `metrics.comparison_period`,
--    acceptat de RPC-urile care validează tipul. Perioada rămâne una obișnuită (nu e „incompletă” ca `ytd`).
-- 2. Google AI Overviews separat de asistenții AI (propunere: „rămâne separat de răspunsurile unui chatbot”):
--    metricile AI primesc versiunea 2, calculată doar din răspunsurile asistenților (ChatGPT, Gemini, Perplexity), iar
--    AI Overviews are metrica lui. Versiunile 1 rămân în registru, ca istoric; analizele publicate își păstrează instantaneul.

-- 1. Comparația cu anul trecut ---------------------------------------------------------------------------------------------

create or replace function metrics.comparison_period(p_start date, p_end date, p_kind text default 'custom')
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_start date;
  v_end date;
  v_ref_month date;
  v_ref_month_end date;
  v_month_start date;
begin
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Perioadă invalidă: % – %', p_start, p_end using errcode = '22023';
  end if;

  if p_kind = 'mtd' then
    v_month_start := date_trunc('month', p_start)::date;
    v_ref_month := (v_month_start - interval '1 month')::date;
    v_ref_month_end := (v_ref_month + interval '1 month' - interval '1 day')::date;
    v_start := least(v_ref_month + (p_start - v_month_start), v_ref_month_end);
    v_end := least(v_ref_month + (p_end - v_month_start), v_ref_month_end);
  elsif p_kind in ('ytd', 'yoy') then
    -- Scăderea unui an limitează 29 februarie la 28 februarie.
    v_start := (p_start - interval '1 year')::date;
    v_end := (p_end - interval '1 year')::date;
  else
    v_end := p_start - 1;
    v_start := p_start - (p_end - p_start + 1);
  end if;

  return jsonb_build_object('start', v_start, 'end', v_end);
end;
$$;

-- Trei RPC-uri validează tipul de perioadă cu aceeași listă; restul îl trimit direct la `comparison_period`.
-- Corpul lor nu se rescrie aici: lista se extinde în definiția existentă, iar migrația se oprește dacă textul
-- așteptat lipsește (o funcție rescrisă între timp trebuie revăzută de mână, nu modificată pe nevăzute).
do $$
declare
  f record;
  v_def text;
  v_old constant text := $t$not in ('custom', 'mtd')$t$;
  v_new constant text := $t$not in ('custom', 'mtd', 'yoy')$t$;
  v_done integer := 0;
begin
  for f in
    select p.oid, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('brand_metrics', 'brand_paid', 'brand_competition')
  loop
    v_def := pg_get_functiondef(f.oid);
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception 'Funcția % nu mai are validarea așteptată a tipului de perioadă', f.proname;
    end if;
    execute replace(v_def, v_old, v_new);
    v_done := v_done + 1;
  end loop;
  if v_done <> 3 then
    raise exception 'Așteptam 3 funcții cu validarea tipului de perioadă, am găsit %', v_done;
  end if;
end;
$$;

-- 2. AI Overviews separat de asistenții AI ------------------------------------------------------------------------------------

insert into public.metric_definitions
  (metric_key, version, name_ro, formula_ro, unit, primary_source, aggregation, multiplier, weight_basis,
   aggregation_label, direction, min_sample, freshness_grace_days, lifecycle, lifecycle_note, valid_from, doc_ref)
values
  ('ai_mention_rate', 2, 'AI Mention Rate', '100 × răspunsuri valide ale asistenților AI (ChatGPT, Gemini, Perplexity) cu brandul menționat / toate răspunsurile lor valide (refuzurile intră la numitor; erorile tehnice nu). Google AI Overviews se raportează separat.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Forma răspunsurilor AI SEOmonitor e derivată din documentație; se confirmă la prima rulare reală.', '2026-11-10', 'docs/metrics/registry.md#ai_mention_rate'),
  ('ai_owned_citation_rate', 2, 'Owned Citation Rate', '100 × răspunsuri valide ale asistenților AI cu cel puțin o citare a domeniului propriu / răspunsurile lor valide. Google AI Overviews nu intră.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Citare eligibilă = URL pe domeniul brandului (sau subdomeniu); se confirmă la prima rulare reală.', '2026-11-10', 'docs/metrics/registry.md#ai_owned_citation_rate'),
  ('ai_sov', 2, 'AI SoV în setul urmărit', '100 × prezențele brandului / suma prezențelor brandului și ale competitorilor din setul în vigoare, maximum una per brand și răspuns, în răspunsurile asistenților AI. Google AI Overviews nu intră.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Prezențele competitorilor vin din competiția AI SEOmonitor; potrivirea pe domeniul din setul de competitori.', '2026-11-10', 'docs/metrics/registry.md#ai_sov'),
  ('ai_valid_answers', 2, 'Răspunsuri AI valide', 'Numărul de răspunsuri ale asistenților AI colectate fără eroare tehnică (inclusiv refuzurile valide); suma zilelor de colectare. Google AI Overviews nu intră.', 'count', 'seomonitor', 'sum', 1, null,
   null, 'neutral', null, 7, 'draft', 'Ritm săptămânal: zilele dintre colectări sunt acoperite de colectarea din ultimele 7 zile.', '2026-11-10', 'docs/metrics/registry.md#ai_valid_answers'),
  ('ai_overviews_mention_rate', 1, 'AI Overviews: Mention Rate', '100 × Google AI Overviews valide în care apare brandul / toate AI Overviews valide colectate (desktop și mobil). Suprafață de căutare, separată de asistenții AI.', 'percent', 'seomonitor', 'ratio', 100, null,
   null, 'higher_is_better', 50, 7, 'draft', 'Colectarea AI Overviews depinde de add-onul din abonamentul SEOmonitor; se confirmă la prima rulare reală.', '2026-11-10', 'docs/metrics/registry.md#ai_overviews_mention_rate');

-- Aceleași coloane și aceeași regulă de stări ca în D-15; se schimbă doar ce răspunsuri intră în fiecare metrică.
create or replace view public.ai_metric_observations
with (security_invoker = true) as
with answers as (
  select a.tenant_id, a.brand_id, a.crawl_at as date, a.engine, a.surface, a.keyword_id, a.device, a.status,
         exists (select 1 from public.ai_citations c
                 where c.tenant_id = a.tenant_id and c.brand_id = a.brand_id and c.engine = a.engine and c.keyword_id = a.keyword_id
                   and c.crawl_at = a.crawl_at and c.device = a.device and c.is_own_domain) as owned_citation
  from public.ai_answers a
), assistants as (
  select * from answers where surface = 'ai_search'
)
select tenant_id, brand_id, 'ai_mention_rate'::text as metric_key, date, null::numeric as value,
       count(*) filter (where status = 'brand_present')::numeric as numerator,
       count(*) filter (where status <> 'technical_error')::numeric as denominator
from assistants group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'ai_owned_citation_rate', date, null,
       count(*) filter (where status <> 'technical_error' and owned_citation)::numeric,
       count(*) filter (where status <> 'technical_error')::numeric
from assistants group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'ai_valid_answers', date, count(*) filter (where status <> 'technical_error')::numeric, null, null
from assistants group by tenant_id, brand_id, date
union all
select tenant_id, brand_id, 'ai_overviews_mention_rate', date, null,
       count(*) filter (where status = 'brand_present')::numeric,
       count(*) filter (where status <> 'technical_error')::numeric
from answers where surface = 'ai_overview' group by tenant_id, brand_id, date
union all
select o.tenant_id, o.brand_id, 'ai_sov', o.crawl_at, null,
       count(distinct (o.engine, o.keyword_id, o.device)) filter (where o.is_own_brand and o.present)::numeric,
       count(distinct (o.engine, o.keyword_id, o.device, o.observed_domain)) filter (where o.present and (o.is_own_brand or exists (
         select 1 from public.competitor_sets cs join public.competitor_set_members m on m.competitor_set_id = cs.id
         where cs.tenant_id = o.tenant_id and cs.brand_id = o.brand_id and m.domain = o.observed_domain
           and cs.effective_from = (select max(c2.effective_from) from public.competitor_sets c2
                                    where c2.tenant_id = o.tenant_id and c2.brand_id = o.brand_id and c2.effective_from <= o.crawl_at))))::numeric
from public.ai_brand_observations o
where o.status <> 'technical_error' and o.engine <> 'google_ai_overview'
group by o.tenant_id, o.brand_id, o.crawl_at;

comment on view public.ai_metric_observations is
  'Observațiile metricilor AI Visibility pe ziua colectării (D-15, H-2). Metricile ai_* numără doar asistenții AI (surface = ai_search); '
  'Google AI Overviews are ai_overviews_mention_rate. Recommendation Rate nu are observații (fără semnal în sursă).';

-- Matricea de Concurență compară Mention Rate și rata de citare pe aceleași răspunsuri ca metricile de mai sus:
-- doar asistenții AI. Fără asta, cardul din Overview și rândul din comparație ar avea numitori diferiți.
create function private.ai_assistant_scope(p_brand_id uuid, p_start date, p_end date)
returns table (id uuid, tenant_id uuid, engine text, keyword_id text, device text, crawl_at date, status text, group_id text, group_name text, content text)
language sql stable set search_path = '' as $$
  select s.* from private.ai_scope(p_brand_id, p_start, p_end, null, null) s where s.engine <> 'google_ai_overview';
$$;
revoke all on function private.ai_assistant_scope(uuid, date, date) from public, anon;
grant execute on function private.ai_assistant_scope(uuid, date, date) to authenticated, service_role;

do $$
declare
  v_oid oid;
  v_def text;
  v_old constant text := 'private.ai_scope(p_brand_id, p_start, p_end, null, null)';
  v_new constant text := 'private.ai_assistant_scope(p_brand_id, p_start, p_end)';
  v_hits integer;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'brand_competition';
  v_def := pg_get_functiondef(v_oid);
  v_hits := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_hits <> 5 then
    raise exception 'brand_competition: așteptam 5 apeluri ai_scope pe toate engine-urile, am găsit %', v_hits;
  end if;
  execute replace(v_def, v_old, v_new);
end;
$$;
