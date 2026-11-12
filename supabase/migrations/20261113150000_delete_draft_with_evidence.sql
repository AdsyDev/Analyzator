-- O ciornă cu dovezi sau recomandări nu se putea șterge (deciziile T din docs/decisions.md).
--
-- `require_draft_parent` cere ca analiza-părinte să fie `draft` la orice schimbare a dovezilor și recomandărilor. La
-- ștergerea unei ciorne, baza șterge în cascadă dovezile și recomandările ei, dar în acel moment analiza nu mai există,
-- iar regula refuza cu „analiza e inexistentă”. Ștergerea ciornei eșua deci pentru orice ciornă cu cel puțin o dovadă.
--
-- O analiză se poate șterge doar cât e ciornă (`insights_guard`), deci cascada apare numai pentru ciorne: când părintele
-- nu mai există, rândul-copil pleacă odată cu el. Ștergerea directă a unei dovezi sau recomandări rămâne permisă doar
-- cât analiza e ciornă.

create or replace function private.require_draft_parent() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_status text;
begin
  select status into v_status from public.insights where id = (v_row ->> 'insight_id')::uuid;
  -- Ștergerea în cascadă a unei ciorne: analiza a fost deja ștearsă, iar dovezile și recomandările pleacă odată cu ea.
  if tg_op = 'DELETE' and v_status is null then
    return old;
  end if;
  if v_status is distinct from 'draft' then
    raise exception 'Dovezile și recomandările se modifică doar cât analiza e în draft (acum: %)', coalesce(v_status, 'inexistentă') using errcode = '42501';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
  end if;
  return coalesce(new, old);
end;
$$;
