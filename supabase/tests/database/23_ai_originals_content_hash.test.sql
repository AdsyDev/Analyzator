-- SEOmonitor (D-26): hash-ul conținutului pentru originalele răspunsurilor AI. Coloană opțională, doar hex sha256;
-- politicile RLS ale tabelului rămân aceleași (clientul nu scrie, citește doar agenția).
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select has_column('public', 'ai_answer_originals', 'content_sha256', 'O1: ai_answer_originals are content_sha256');
select col_is_null('public', 'ai_answer_originals', 'content_sha256', 'O1: rândurile vechi pot rămâne fără hash (NULL)');

select ok(
  exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.ai_answer_originals'::regclass and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%content_sha256%' and pg_get_constraintdef(c.oid) like '%[0-9a-f]{64}%'
  ),
  'O2: content_sha256 acceptă doar 64 de caractere hex (constrângere CHECK)'
);

select policies_are('public', 'ai_answer_originals',
  array['ai_answer_originals_select', 'ai_answer_originals_insert', 'ai_answer_originals_update', 'ai_answer_originals_delete'],
  'O3: politicile RLS ale originalelor nu s-au schimbat');

select * from finish();
rollback;
