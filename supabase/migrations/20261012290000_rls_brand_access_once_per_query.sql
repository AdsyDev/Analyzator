-- Viteza ecranelor pe date reale (D-20, E9). Politicile SELECT ale tabelelor de date foloseau
-- `private.has_brand_access(brand_id)`: o funcție SECURITY DEFINER, pe care Postgres n-o poate integra în plan, deci o
-- apela pentru fiecare rând. Pe Minimartieni (12 oct 2026, ~35.000 de poziții SEOmonitor) cele 6 carduri SEO cereau
-- 5,7 s și prima încărcare depășea limita de timp. Local, pe ~42.000 de rânduri: 4.704 ms → 58 ms.
--
-- Regula de acces nu se schimbă: `accessible_brand_ids()` e SECURITY INVOKER și citește `brands` prin RLS-ul apelantului,
-- a cărui politică este chiar `has_brand_access(id)`; deci întoarce exact brandurile pentru care `has_brand_access` e
-- adevărat (evaluat pe câteva rânduri de branduri, nu pe zeci de mii de rânduri de date). Subinterogarea nu depinde de
-- rând, deci se calculează o dată pe interogare. Politicile cu condiții compuse (analize, acțiuni, branduri) rămân.

create function private.accessible_brand_ids()
returns setof uuid
language sql
stable
security invoker
set search_path = ''
as $$
  select b.id from public.brands b;
$$;

comment on function private.accessible_brand_ids() is
  'Brandurile vizibile apelantului prin RLS pe brands (= has_brand_access). Pentru politici RLS evaluate o dată pe interogare. E9.';

revoke all on function private.accessible_brand_ids() from public, anon;
grant execute on function private.accessible_brand_ids() to authenticated;

alter policy ai_answers_select on public.ai_answers using (brand_id in (select private.accessible_brand_ids()));
alter policy ai_brand_observations_select on public.ai_brand_observations using (brand_id in (select private.accessible_brand_ids()));
alter policy ai_citations_select on public.ai_citations using (brand_id in (select private.accessible_brand_ids()));
alter policy clarity_daily_select on public.clarity_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy competitor_set_members_select on public.competitor_set_members using (brand_id in (select private.accessible_brand_ids()));
alter policy competitor_sets_select on public.competitor_sets using (brand_id in (select private.accessible_brand_ids()));
alter policy keyword_groups_select on public.keyword_groups using (brand_id in (select private.accessible_brand_ids()));
alter policy keywords_select on public.keywords using (brand_id in (select private.accessible_brand_ids()));
alter policy mentions_select on public.mentions using (brand_id in (select private.accessible_brand_ids()));
alter policy paid_daily_select on public.paid_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy rank_observations_select on public.rank_observations using (brand_id in (select private.accessible_brand_ids()));
alter policy search_daily_select on public.search_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy search_queries_select on public.search_queries using (brand_id in (select private.accessible_brand_ids()));
alter policy seomonitor_ai_engine_stats_select on public.seomonitor_ai_engine_stats using (brand_id in (select private.accessible_brand_ids()));
alter policy seomonitor_ai_visibility_daily_select on public.seomonitor_ai_visibility_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy seomonitor_group_visibility_daily_select on public.seomonitor_group_visibility_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy social_daily_select on public.social_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy social_posts_select on public.social_posts using (brand_id in (select private.accessible_brand_ids()));
alter policy web_active_users_interval_select on public.web_active_users_interval using (brand_id in (select private.accessible_brand_ids()));
alter policy web_daily_select on public.web_daily using (brand_id in (select private.accessible_brand_ids()));
alter policy web_key_events_select on public.web_key_events using (brand_id in (select private.accessible_brand_ids()));
