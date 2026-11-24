-- Limba mențiunilor competitorilor, ca matricea de Competiție să fie doar pe română (deciziile AF din docs/decisions.md,
-- cererea din 24 nov. 2026). Revine asupra AE-3: brandul și competitorii se numără acum pe aceeași bază, doar română.
--
-- Textul mențiunilor competitorilor nu se păstrează (Y-5, minimizare). Se păstrează doar limba, stabilită cu aceeași funcție
-- ca la brand (`metrics.text_language_v1`), ca brandul și competitorii să fie judecați la fel:
-- 1. `competitor_mentions.language_text` e o coloană de intrare: workerul trimite textul, un trigger BEFORE îl clasifică în
--    `language_detected` și îl golește înainte ca rândul să fie scris. Constrângerea `language_text is null` (verificată după
--    trigger) garantează că textul nu ajunge niciodată în tabel.
-- 2. La o actualizare fără text (reimport), limba deja stabilită rămâne.
-- 3. Matricea: mențiunile competitorilor clar în altă limbă nu se mai numără, iar celula brandului revine la `mentions_count`
--    din registru (versiunea 2, doar română), fără excepția din AE-3.
--
-- Mențiunile competitorilor scrise înainte nu au limbă (NULL = nedeterminată), deci se numără până când colectarea Planable
-- le rescrie (fereastra de 35 de zile). Cele mai vechi rămân nedeterminate: textul lor nu mai există.

-- 1. Coloanele și triggerul ------------------------------------------------------------------------------------------------------

alter table public.competitor_mentions
  add column language_detected text check (language_detected in ('ro', 'other')),
  add column language_text text,
  add constraint competitor_mentions_text_not_stored check (language_text is null);
comment on column public.competitor_mentions.language_detected is
  'Limba stabilită din textul mențiunii cu metrics.text_language_v1: ro / other / NULL (nedeterminată). Textul nu se păstrează.';
comment on column public.competitor_mentions.language_text is
  'Doar intrare: textul trimis de worker pentru stabilirea limbii. Triggerul îl golește înainte de scriere; e mereu NULL în tabel.';

create function private.competitor_mention_language()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.language_text is not null then
    new.language_detected := metrics.text_language_v1(new.language_text);
  elsif tg_op = 'UPDATE' then
    new.language_detected := old.language_detected;
  end if;
  new.language_text := null;
  return new;
end;
$$;
revoke all on function private.competitor_mention_language() from public, anon, authenticated;

create trigger competitor_mentions_language before insert or update on public.competitor_mentions
  for each row execute function private.competitor_mention_language();

-- 2. Matricea de Competiție: doar română pentru toate entitățile -------------------------------------------------------------------

do $$
declare
  v_def text;
  -- Competitorii: fără mențiunile clar în altă limbă.
  v_old_c constant text := $q$    select count(distinct cm.native_id) into v_num from public.competitor_mentions cm
    where cm.brand_id = p_brand_id and cm.keyword_id = any (v_ids) and cm.published_at >= v_from_ts and cm.published_at < v_to_ts;$q$;
  v_new_c constant text := $q$    select count(distinct cm.native_id) into v_num from public.competitor_mentions cm
    where cm.brand_id = p_brand_id and cm.keyword_id = any (v_ids) and cm.published_at >= v_from_ts and cm.published_at < v_to_ts
      and not metrics.mention_other_language(null, cm.language_detected);$q$;
  -- Brandul: înapoi la celula din registru (mentions_count v2, doar română); excepția din AE-3 nu mai e necesară.
  v_old_b constant text := $q$  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');
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
  v_new_b constant text := $q$  -- Deciziile AF: brandul din registru (mentions_count v2, doar română), ca și competitorii.
  v_listen := private.competition_registry_cell(v_brand.tenant_id, p_brand_id, 'mentions_count', p_start, p_end, p_kind, '{}');$q$;
begin
  select pg_get_functiondef('public.brand_competition(uuid, date, date, text)'::regprocedure) into v_def;
  if (length(v_def) - length(replace(v_def, v_old_c, ''))) / length(v_old_c) <> 1 then
    raise exception 'brand_competition nu mai are numărarea mențiunilor competitorilor așteptată';
  end if;
  if (length(v_def) - length(replace(v_def, v_old_b, ''))) / length(v_old_b) <> 1 then
    raise exception 'brand_competition nu mai are celula Listening a brandului din AE';
  end if;
  execute replace(replace(v_def, v_old_c, v_new_c), v_old_b, v_new_b);
end;
$$;
