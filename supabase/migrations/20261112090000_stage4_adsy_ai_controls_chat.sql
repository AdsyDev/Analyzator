-- Etapa 4 din propunerea „Specificația dashboardurilor pentru clienți”, prima felie (deciziile M din docs/decisions.md):
-- controalele AdSy AI și jurnalul cererilor către model.
--
-- 1. `ai_brand_policies`: politica brandului, trei controale (chat, generare, afișare) și plafonul lunar de tokeni.
--    O scrie doar agency_admin. Fără rând, totul e oprit: AI-ul pornește doar printr-o decizie explicită.
-- 2. `ai_user_preferences`: preferința personală (chat, afișare), pe utilizator și brand. Fiecare și-o scrie pe a lui.
-- 3. `ai_requests`: fiecare cerere către model, cu tokenii consumați, și răspunsul validat (cache). Scrie doar serverul.
-- 4. `brand_ai_settings`: starea efectivă. Politica brandului bate preferința personală. Regimul E8.
--
-- Modelul e chemat doar din funcția server `adsy-ai`; cheia lui nu ajunge în bază, în interfață sau în prompt.

-- 1. Politica brandului --------------------------------------------------------------------------------------------------

create table public.ai_brand_policies (
  tenant_id            uuid not null,
  brand_id             uuid not null,
  chat_enabled         boolean not null default false,
  generation_enabled   boolean not null default false,
  display_enabled      boolean not null default false,
  -- Plafonul lunar al brandului, în tokeni (intrare + ieșire). La atingere, serverul refuză cererile noi.
  monthly_token_cap    bigint not null default 2000000 check (monthly_token_cap between 1 and 1000000000),
  updated_by           uuid not null,
  updated_at           timestamptz not null default now(),
  primary key (tenant_id, brand_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.ai_brand_policies is
  'Politica AdSy AI a brandului: chat, generare de analize, afișarea conținutului generat și plafonul lunar de tokeni. '
  'Fără rând, toate cele trei sunt oprite. Scrisă doar de agency_admin.';
create trigger ai_brand_policies_updated_at before update on public.ai_brand_policies
  for each row execute function private.set_updated_at();

alter table public.ai_brand_policies enable row level security;
revoke all on public.ai_brand_policies from public, anon, authenticated;
grant select on public.ai_brand_policies to authenticated;
grant insert (tenant_id, brand_id, chat_enabled, generation_enabled, display_enabled, monthly_token_cap, updated_by) on public.ai_brand_policies to authenticated;
grant update (chat_enabled, generation_enabled, display_enabled, monthly_token_cap, updated_by) on public.ai_brand_policies to authenticated;
grant all on public.ai_brand_policies to service_role;

-- Oricine are acces la brand vede politica (clientul trebuie să știe de ce AI-ul e oprit); o schimbă doar agency_admin.
create policy ai_brand_policies_select on public.ai_brand_policies for select to authenticated
  using (brand_id in (select private.accessible_brand_ids()));
create policy ai_brand_policies_insert on public.ai_brand_policies for insert to authenticated
  with check (private.has_brand_role(brand_id, array['agency_admin']::public.membership_role[]) and updated_by = (select auth.uid()));
create policy ai_brand_policies_update on public.ai_brand_policies for update to authenticated
  using (private.has_brand_role(brand_id, array['agency_admin']::public.membership_role[]))
  with check (private.has_brand_role(brand_id, array['agency_admin']::public.membership_role[]) and updated_by = (select auth.uid()));
create policy ai_brand_policies_delete on public.ai_brand_policies for delete to authenticated
  using (false);

create trigger ai_brand_policies_audit after insert or update on public.ai_brand_policies
  for each row execute function private.audit_row();

-- 2. Preferința personală -----------------------------------------------------------------------------------------------

create table public.ai_user_preferences (
  tenant_id        uuid not null,
  brand_id         uuid not null,
  user_id          uuid not null,
  chat_enabled     boolean not null default true,
  display_enabled  boolean not null default true,
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, brand_id, user_id),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.ai_user_preferences is
  'Preferința personală AdSy AI pe brand: utilizatorul își poate opri chatul și afișarea conținutului generat. '
  'Poate doar să restrângă ce permite politica brandului, niciodată să o depășească.';
create trigger ai_user_preferences_updated_at before update on public.ai_user_preferences
  for each row execute function private.set_updated_at();

alter table public.ai_user_preferences enable row level security;
revoke all on public.ai_user_preferences from public, anon, authenticated;
grant select on public.ai_user_preferences to authenticated;
grant insert (tenant_id, brand_id, user_id, chat_enabled, display_enabled) on public.ai_user_preferences to authenticated;
grant update (chat_enabled, display_enabled) on public.ai_user_preferences to authenticated;
grant all on public.ai_user_preferences to service_role;

-- Doar rândul propriu, și doar pe un brand la care utilizatorul are acces.
create policy ai_user_preferences_select on public.ai_user_preferences for select to authenticated
  using (user_id = (select auth.uid()) and brand_id in (select private.accessible_brand_ids()));
create policy ai_user_preferences_insert on public.ai_user_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and private.has_brand_access(brand_id));
create policy ai_user_preferences_update on public.ai_user_preferences for update to authenticated
  using (user_id = (select auth.uid()) and private.has_brand_access(brand_id))
  with check (user_id = (select auth.uid()) and private.has_brand_access(brand_id));
create policy ai_user_preferences_delete on public.ai_user_preferences for delete to authenticated
  using (false);

-- 3. Jurnalul cererilor ----------------------------------------------------------------------------------------------------

create table public.ai_requests (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  brand_id          uuid not null,
  user_id           uuid not null,
  task              text not null check (task in ('chat', 'generate_insight')),
  model_id          text not null check (length(model_id) between 1 and 128),
  prompt_version    text not null check (length(prompt_version) between 1 and 64),
  question          text check (question is null or length(question) between 1 and 2000),
  period_start      date not null,
  period_end        date not null,
  -- Amprenta datelor trimise modelului: aceleași date, aceeași întrebare, același model și prompt = același răspuns.
  data_snapshot_id  text not null check (data_snapshot_id ~ '^[0-9a-f]{64}$'),
  cache_key         text not null check (cache_key ~ '^[0-9a-f]{64}$'),
  -- ok = răspuns cu dovezi verificate; insufficient_evidence = răspunsul nu a trecut verificarea sau modelul a spus că
  -- nu are date; out_of_scope = întrebare în afara datelor brandului; rejected = răspuns în afara contractului;
  -- error = apelul către model a eșuat.
  status            text not null check (status in ('ok', 'insufficient_evidence', 'out_of_scope', 'rejected', 'error')),
  response          jsonb,
  rejection_reason  text check (rejection_reason is null or length(rejection_reason) <= 500),
  -- Răspunsul a venit din cache: nu s-a făcut niciun apel către model și nu s-au consumat tokeni.
  cached_from       uuid references public.ai_requests (id) on delete set null,
  prompt_tokens     integer not null default 0 check (prompt_tokens >= 0),
  output_tokens     integer not null default 0 check (output_tokens >= 0),
  total_tokens      integer not null default 0 check (total_tokens >= 0),
  created_at        timestamptz not null default now(),
  check (period_end >= period_start),
  foreign key (tenant_id, brand_id) references public.brands (tenant_id, id) on delete restrict
);
comment on table public.ai_requests is
  'Fiecare cerere AdSy AI către model: cine, pe ce brand și perioadă, cu ce model și versiune de prompt, câți tokeni și cu '
  'ce rezultat. Răspunsul validat servește drept cache. Scris doar de funcția server adsy-ai.';
create index ai_requests_brand_month_idx on public.ai_requests (tenant_id, brand_id, created_at);
create index ai_requests_cache_idx on public.ai_requests (tenant_id, brand_id, cache_key, created_at desc);
create index ai_requests_user_day_idx on public.ai_requests (user_id, created_at);

alter table public.ai_requests enable row level security;
revoke all on public.ai_requests from public, anon, authenticated;
grant select on public.ai_requests to authenticated;
grant all on public.ai_requests to service_role;

-- Fiecare își vede cererile; agency_admin vede toate cererile brandului (costul). Nimeni nu scrie din sesiunea lui.
create policy ai_requests_select on public.ai_requests for select to authenticated
  using (
    brand_id in (select private.accessible_brand_ids())
    and (user_id = (select auth.uid()) or private.has_brand_role(brand_id, array['agency_admin']::public.membership_role[]))
  );
create policy ai_requests_insert on public.ai_requests for insert to authenticated
  with check (false);
create policy ai_requests_update on public.ai_requests for update to authenticated
  using (false);
create policy ai_requests_delete on public.ai_requests for delete to authenticated
  using (false);

-- 4. Starea efectivă --------------------------------------------------------------------------------------------------------

create function public.brand_ai_settings(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_policy record;
  v_pref record;
  v_admin boolean;
  v_month_start timestamptz;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;

  select p.chat_enabled, p.generation_enabled, p.display_enabled, p.monthly_token_cap, p.updated_at into v_policy
  from public.ai_brand_policies p where p.brand_id = p_brand_id;
  select u.chat_enabled, u.display_enabled into v_pref
  from public.ai_user_preferences u where u.brand_id = p_brand_id and u.user_id = (select auth.uid());
  v_admin := private.has_brand_role(p_brand_id, array['agency_admin']::public.membership_role[]);
  -- Luna calendaristică în Europe/Bucharest (regula 9).
  v_month_start := date_trunc('month', now() at time zone 'Europe/Bucharest') at time zone 'Europe/Bucharest';

  return jsonb_build_object(
    'tenant_id', (select b.tenant_id from public.brands b where b.id = p_brand_id),
    -- Fără politică salvată, toate cele trei sunt oprite.
    'policy', jsonb_build_object(
      'chat', coalesce(v_policy.chat_enabled, false),
      'generation', coalesce(v_policy.generation_enabled, false),
      'display', coalesce(v_policy.display_enabled, false),
      'monthly_token_cap', v_policy.monthly_token_cap,
      'updated_at', v_policy.updated_at),
    -- Fără preferință salvată, utilizatorul nu a oprit nimic.
    'preference', jsonb_build_object('chat', coalesce(v_pref.chat_enabled, true), 'display', coalesce(v_pref.display_enabled, true)),
    -- Politica brandului bate preferința: preferința poate doar să restrângă. Generarea nu are preferință personală.
    'effective', jsonb_build_object(
      'chat', coalesce(v_policy.chat_enabled, false) and coalesce(v_pref.chat_enabled, true),
      'generation', coalesce(v_policy.generation_enabled, false),
      'display', coalesce(v_policy.display_enabled, false) and coalesce(v_pref.display_enabled, true)),
    'can_edit_policy', v_admin,
    -- Consumul lunii îl vede doar cine vede toate cererile brandului (agency_admin); altfel ar fi doar consumul propriu.
    'month_tokens', case when v_admin then
      (select coalesce(sum(r.total_tokens), 0) from public.ai_requests r where r.brand_id = p_brand_id and r.created_at >= v_month_start) end);
end;
$$;

revoke all on function public.brand_ai_settings(uuid) from public, anon;
grant execute on function public.brand_ai_settings(uuid) to authenticated, service_role;
comment on function public.brand_ai_settings(uuid) is
  'Politica AdSy AI a brandului, preferința utilizatorului curent și starea efectivă (politica bate preferința). SECURITY INVOKER; verifică has_brand_access (E8).';
