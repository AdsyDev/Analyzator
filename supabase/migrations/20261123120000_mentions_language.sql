-- Listening doar în limba română (deciziile AA din docs/decisions.md, cererea din 23 nov. 2026).
--
-- Planable Listening găsește cuvântul urmărit („Proenzi”) în orice limbă: maghiară, spaniolă, vietnameză, arabă.
-- Planable nu trimite limba mențiunii (câmpurile primite: platform, publishedAt, url, text, sentiment, author, engagement),
-- iar CSV-ul o are opțional (`mentions.language`). Limba se stabilește deci din text, cu o funcție pură și versionată:
--
-- 1. `metrics.text_language_v1(text)` → 'ro' / 'other' / NULL (nedeterminată: text lipsă, prea scurt sau ambiguu).
--    Spune „altă limbă” doar când textul o arată limpede; nu ascunde o mențiune românească scurtă (regula 8: nu se deduce
--    ce nu se poate stabili).
-- 2. `mentions.language_detected`, coloană generată din text: se calculează la scriere (conector, CSV) și se recalculează
--    pentru rândurile existente la aplicarea migrației. Limba declarată de sursă (`language`) are întâietate.
-- 3. `metrics.mention_other_language(language, language_detected)`: regula unică de excludere, folosită de ambele RPC-uri.
-- 4. `brand_mentions` și `brand_mention_sentiment` primesc `p_language` ('ro' implicit, 'all') și întorc `other_language`:
--    câte mențiuni cu conținut au fost lăsate deoparte pentru limbă, ca interfața să spună de ce lipsesc.
--
-- Ce nu se schimbă: metrica `mentions_count` (formula ei e în registru; o schimbare cere versiune nouă și contract),
-- tabelele competitorilor și jurnalul de farmacovigilență (marcajele existente rămân).

-- 1. Clasificatorul ----------------------------------------------------------------------------------------------------------

create function metrics.text_language_v1(p_text text)
returns text
language plpgsql
immutable
parallel safe
set search_path = ''
as $$
declare
  -- Cuvinte frecvente în română și rare în alte limbi. Lipsesc intenționat cele comune cu alte limbi (de, la, un, se, el,
  -- le, au, il, da, os, des, pas, una, este, dar, ce, te, am, ai, si, sa, ca, in), ca să nu numere textele străine.
  c_ro constant text[] := array[
    'și', 'să', 'că', 'în', 'îți', 'își', 'îmi', 'îl', 'într', 'dintr', 'printr', 'pentru', 'sunt', 'care', 'foarte', 'fără',
    'fara', 'după', 'dupa', 'până', 'pana', 'această', 'aceasta', 'acest', 'acesta', 'aceste', 'acestea', 'despre', 'poate',
    'mult', 'multe', 'mai', 'din', 'ale', 'cel', 'cea', 'cele', 'sau', 'prin', 'către', 'catre', 'noi', 'vă', 'ți', 'cu', 'pe',
    'zi', 'zile', 'ziua', 'acum', 'aici', 'bine', 'doar', 'toate', 'totul', 'tot', 'însă', 'insa', 'deja', 'fiecare', 'lor',
    'lui', 'fost', 'nu', 'mă', 'iar', 'decât', 'decat', 'înainte', 'inainte', 'chiar', 'recomand', 'mulțumesc', 'multumesc',
    'vreau', 'trebuie', 'bună', 'buna', 'nici', 'încă', 'inca', 'atât', 'atat', 'cum', 'unde', 'când', 'cand'];
  -- Cuvinte frecvente în alte limbi și care nu sunt cuvinte românești uzuale (engleză, spaniolă, franceză, italiană,
  -- portugheză, germană, maghiară, turcă, olandeză, poloneză).
  c_other constant text[] := array[
    'the', 'and', 'is', 'was', 'with', 'for', 'you', 'your', 'this', 'that', 'have', 'has', 'of', 'to', 'it', 'my', 'our',
    'not', 'from', 'but', 'what', 'que', 'los', 'las', 'del', 'por', 'con', 'es', 'para', 'pero', 'como', 'muy', 'su', 'lo',
    'sin', 'les', 'est', 'pour', 'avec', 'et', 'une', 'je', 'dans', 'qui', 'vous', 'nous', 'che', 'di', 'della', 'non', 'sono',
    'gli', 'molto', 'anche', 'questo', 'questa', 'sto', 'ho', 'com', 'uma', 'em', 'und', 'der', 'die', 'das', 'ist', 'mit', 'nicht', 'ich', 'sie', 'wir', 'auf', 'ein', 'eine',
    'zu', 'az', 'egy', 'hogy', 'nem', 'van', 'meg', 'csak', 've', 'bir', 'bu', 'ile', 'daha', 'iyi', 'gibi', 'ama', 'yok', 'het', 'een', 'niet', 'ik', 'nie', 'jest'];
  v_norm text;
  v_words text[];
  v_ro_words integer;
  v_other_words integer;
  v_ro_marks integer := 0;
  v_foreign_letters integer;
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  -- Literele românești mari → mici (lower() nu le schimbă în toate colațiile) și sedila → virgula de dedesubt.
  v_norm := lower(translate(p_text, 'ĂÂÎȘȚŞŢşţ', 'ăâîșțșțșț'));
  v_words := array(select w from regexp_split_to_table(v_norm, '[^a-zăâîșț]+') w where w <> '');
  select count(*) filter (where w = any (c_ro)), count(*) filter (where w = any (c_other))
    into v_ro_words, v_other_words
  from unnest(v_words) w;
  if v_norm ~ '[șț]' then v_ro_marks := v_ro_marks + 2; end if;
  if v_norm ~ '[ăâî]' then v_ro_marks := v_ro_marks + 1; end if;
  -- Litere din alte alfabete sau cu diacritice care nu există în română (á, é, ő, ñ, ç, ạ, ơ, ı, chirilice, arabe, CJK…).
  v_foreign_letters := length(regexp_replace(translate(p_text, 'ĂÂÎȘȚŞŢăâîșțşţ', ''),
                                             '[^À-ÖØ-öø-ɏͰ-῿぀-鿿가-힯]', '', 'g'));

  if v_ro_words + v_ro_marks >= 2 and v_other_words <= v_ro_words and v_foreign_letters <= 2 then
    return 'ro';
  end if;
  if v_ro_words = 0 and (v_other_words >= 2 or v_foreign_letters >= 3) then
    return 'other';
  end if;
  if v_other_words >= 3 and v_other_words >= 3 * v_ro_words then
    return 'other';
  end if;
  return null;
end;
$$;
comment on function metrics.text_language_v1(text) is
  'Limba unui text de mențiune, v1: ''ro'', ''other'' sau NULL (nedeterminată). Funcție pură; o schimbare a regulilor = versiune nouă.';

-- Regula de excludere: limba declarată de sursă are întâietate; altfel, cea din text. NULL (nedeterminată) nu se exclude.
create function metrics.mention_other_language(p_language text, p_detected text)
returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when p_language is not null then p_language not in ('ro', 'ron', 'rum')
    else p_detected is not distinct from 'other'
  end
$$;
comment on function metrics.mention_other_language(text, text) is
  'true când mențiunea e în altă limbă decât româna: după `language` (sursa), altfel după `language_detected` (textul).';

-- 2. Coloana --------------------------------------------------------------------------------------------------------------------

alter table public.mentions add column language_detected text generated always as (metrics.text_language_v1(text)) stored;
comment on column public.mentions.language_detected is
  'Limba stabilită din text cu metrics.text_language_v1: ro / other / NULL (nedeterminată). Nu e limba declarată de sursă (`language`).';

-- 3. RPC-urile ------------------------------------------------------------------------------------------------------------------

drop function public.brand_mentions(uuid, date, date, text, text, integer, integer, text);

create function public.brand_mentions(
  p_brand_id uuid, p_start date, p_end date, p_sentiment text default null, p_source text default null, p_page integer default 1, p_page_size integer default 20,
  p_author text default 'all', p_language text default 'ro'
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to   timestamptz;
  v_total bigint;
  v_without bigint;
  v_other bigint;
  v_items jsonb;
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if p_sentiment is not null and p_sentiment not in ('positive', 'neutral', 'negative', 'unreviewed') then
    raise exception 'Filtru de sentiment necunoscut' using errcode = '22023';
  end if;
  if coalesce(p_author, 'all') not in ('all', 'external', 'owned') then
    raise exception 'Filtru de autor necunoscut' using errcode = '22023';
  end if;
  if coalesce(p_language, 'ro') not in ('ro', 'all') then
    raise exception 'Filtru de limbă necunoscut' using errcode = '22023';
  end if;
  if p_page < 1 or p_page_size < 1 or p_page_size > 100 then
    raise exception 'Paginare invalidă' using errcode = '22023';
  end if;
  v_from := (p_start::timestamp) at time zone 'Europe/Bucharest';
  v_to := ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest';

  -- Feed-ul arată doar mențiunile cu conținut (link sau text) și, implicit, doar pe cele care nu sunt în altă limbă.
  -- Cele fără conținut și cele în altă limbă se numără separat, pe aceeași perioadă, sursă, autor și sentiment.
  select count(*) filter (where (m.url is not null or coalesce(m.text, '') <> '')
                            and (coalesce(p_language, 'ro') = 'all' or not metrics.mention_other_language(m.language, m.language_detected))),
         count(*) filter (where m.url is null and coalesce(m.text, '') = ''),
         count(*) filter (where (m.url is not null or coalesce(m.text, '') <> '')
                            and coalesce(p_language, 'ro') = 'ro' and metrics.mention_other_language(m.language, m.language_detected))
    into v_total, v_without, v_other
  from public.mentions m
  where m.brand_id = p_brand_id and m.published_at >= v_from and m.published_at < v_to
    and (p_source is null or m.source_name = p_source)
    and (coalesce(p_author, 'all') = 'all'
         or (p_author = 'owned' and m.author_is_owned is true)
         or (p_author = 'external' and m.author_is_owned is not true))
    and (p_sentiment is null
         or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
         or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment));
  -- Cu un filtru de sentiment, numărul celor fără conținut nu are sens (nu au sentiment revizuit și nu așteaptă revizuire).
  if p_sentiment is not null then
    v_without := 0;
  end if;

  select coalesce(jsonb_agg(x.j order by x.published_at desc, x.native_id), '[]'::jsonb) into v_items
  from (
    select m.published_at, m.native_id, jsonb_build_object(
      'id', m.native_id, 'brand_id', m.brand_id, 'source_name', coalesce(m.source_name, 'necunoscută'), 'author', null,
      'published_at', m.published_at, 'text', coalesce(m.text, ''), 'url', m.url,
      -- „Cont propriu” (D-22): true / false / null (necunoscut).
      'owned_account', m.author_is_owned,
      -- Sentimentul apare doar după revizuirea umană; cel al furnizorului nu se arată ca etichetă (spec 2.7).
      'sentiment', case when m.sentiment_reviewed_by is not null and m.sentiment <> 'unknown' then m.sentiment end,
      'reviewed_by', case when m.sentiment_reviewed_by is not null then 'utilizator ' || left(m.sentiment_reviewed_by::text, 8) end,
      'pv_flag', (
        select jsonb_build_object('id', f.id, 'item', jsonb_build_object('kind', 'mention', 'id', f.entity_ref), 'flagged_at', f.flagged_at,
          'flagged_by', 'utilizator ' || left(f.flagged_by::text, 8), 'notified', f.status <> 'open',
          'status', case f.status when 'open' then 'pending' when 'notified' then 'notified' else 'acknowledged' end)
        from public.pv_flags f
        where f.brand_id = m.brand_id and f.entity_type = 'mention' and f.entity_ref = m.native_id
        order by f.flagged_at desc limit 1)
    ) as j
    from public.mentions m
    where m.brand_id = p_brand_id and m.published_at >= v_from and m.published_at < v_to
      and (m.url is not null or coalesce(m.text, '') <> '')
      and (coalesce(p_language, 'ro') = 'all' or not metrics.mention_other_language(m.language, m.language_detected))
      and (p_source is null or m.source_name = p_source)
      and (coalesce(p_author, 'all') = 'all'
           or (p_author = 'owned' and m.author_is_owned is true)
           or (p_author = 'external' and m.author_is_owned is not true))
      and (p_sentiment is null
           or (p_sentiment = 'unreviewed' and m.sentiment_reviewed_by is null)
           or (p_sentiment <> 'unreviewed' and m.sentiment_reviewed_by is not null and m.sentiment = p_sentiment))
    order by m.published_at desc, m.native_id
    offset (p_page - 1) * p_page_size limit p_page_size
  ) x;

  return jsonb_build_object('items', v_items, 'total', v_total, 'page', p_page, 'page_size', p_page_size, 'without_content', v_without,
                            'other_language', v_other);
end;
$$;

revoke all on function public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text) from public, anon;
grant execute on function public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text) to authenticated, service_role;
comment on function public.brand_mentions(uuid, date, date, text, text, integer, integer, text, text) is
  'Mențiunile cu conținut (link sau text) ale brandului, paginate, implicit doar cele care nu sunt în altă limbă (p_language = ro), '
  'cu numărul celor fără conținut și al celor în altă limbă. SECURITY INVOKER; verifică has_brand_access (E8).';

drop function public.brand_mention_sentiment(uuid, date, date);

create function public.brand_mention_sentiment(p_brand_id uuid, p_start date, p_end date, p_language text default 'ro')
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  r record;
  v_all boolean := coalesce(p_language, 'ro') = 'all';
begin
  if (select auth.uid()) is null or not private.has_brand_access(p_brand_id) then
    raise exception 'Nu ai acces la acest spațiu de brand' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 400 then
    raise exception 'Perioadă invalidă' using errcode = '22023';
  end if;
  if coalesce(p_language, 'ro') not in ('ro', 'all') then
    raise exception 'Filtru de limbă necunoscut' using errcode = '22023';
  end if;
  -- Conturile proprii nu intră în distribuție (D-22): sentimentul arată ce spun alții despre brand. Implicit, nici
  -- mențiunile în altă limbă (deciziile AA); ele se numără în `other_language`.
  select count(*) filter (where x.counted and x.sentiment_reviewed_by is not null and x.sentiment in ('positive', 'neutral', 'negative')) as total,
         count(*) filter (where x.counted and x.sentiment_reviewed_by is not null and x.sentiment = 'positive') as positive,
         count(*) filter (where x.counted and x.sentiment_reviewed_by is not null and x.sentiment = 'neutral') as neutral,
         count(*) filter (where x.counted and x.sentiment_reviewed_by is not null and x.sentiment = 'negative') as negative,
         -- „Nerevizuite” = cele care pot fi revizuite: au link sau text. O mențiune fără conținut nu are ce revizui.
         count(*) filter (where x.counted and x.sentiment_reviewed_by is null and x.has_content) as unreviewed,
         count(*) filter (where x.author_is_owned is not true and not x.has_content) as without_content,
         count(*) filter (where x.author_is_owned is not true and x.has_content and x.foreign) as other_language,
         count(*) filter (where x.author_is_owned is true) as owned
    into r
  from (
    select m.sentiment, m.sentiment_reviewed_by, m.author_is_owned,
           (m.url is not null or coalesce(m.text, '') <> '') as has_content,
           (not v_all and metrics.mention_other_language(m.language, m.language_detected)) as foreign,
           (m.author_is_owned is not true and (v_all or not metrics.mention_other_language(m.language, m.language_detected))) as counted
    from public.mentions m
    where m.brand_id = p_brand_id
      and m.published_at >= (p_start::timestamp) at time zone 'Europe/Bucharest'
      and m.published_at < ((p_end + 1)::timestamp) at time zone 'Europe/Bucharest'
  ) x;
  return jsonb_build_object(
    'connected', private.brand_source_connected(p_brand_id, 'planable_listening'),
    'total', r.total, 'positive', r.positive, 'neutral', r.neutral, 'negative', r.negative, 'unreviewed', r.unreviewed,
    'owned_excluded', r.owned,
    'without_content', r.without_content,
    'other_language', r.other_language,
    'shares', jsonb_build_object(
      'positive', metrics.ratio(r.positive, r.total, 100), 'neutral', metrics.ratio(r.neutral, r.total, 100), 'negative', metrics.ratio(r.negative, r.total, 100)));
end;
$$;

revoke all on function public.brand_mention_sentiment(uuid, date, date, text) from public, anon;
grant execute on function public.brand_mention_sentiment(uuid, date, date, text) to authenticated, service_role;
comment on function public.brand_mention_sentiment(uuid, date, date, text) is
  'Distribuția sentimentului revizuit de om, fără conturile proprii și, implicit, fără mențiunile în altă limbă. SECURITY INVOKER; verifică has_brand_access (E8).';

revoke all on all functions in schema metrics from public, anon;
grant execute on all functions in schema metrics to authenticated, service_role;
