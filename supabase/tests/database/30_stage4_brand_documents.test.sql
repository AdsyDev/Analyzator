-- Etapa 4, a treia felie (deciziile P): documente aprobate și căutarea în ele. Date SINTETICE, doar aici.
-- T1 = 1000…0001 · brand 1A = 2000…0011 · brand 1B = 2000…0012 · brand 2A = 2000…0021
-- admin T1 = 3000…0001 · strategist T1 (acces 1A) = …0002 · account T1 (acces doar 1B) = …0003
-- client T1 cu acces la 1A = …0004 · client fără acces = …0005 · admin T2 = …0011
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

-- Rândul se trimite cu valori explicite (nu citite din `brands`), ca un refuz RLS să fie o eroare, nu o inserare goală.
create function pg_temp.doc(p_title text, p_user uuid, p_brand uuid default '20000000-0000-0000-0000-000000000011', p_owner text default 'Medical', p_from date default '2026-01-01', p_to date default null)
returns void language sql as $$
  insert into public.brand_documents (tenant_id, brand_id, title, doc_type, country, language, version, owner, valid_from, valid_to, created_by)
  values ('10000000-0000-0000-0000-000000000001', p_brand, p_title, 'product_info', 'RO', 'ro', '1.0', p_owner, p_from, p_to, p_user)
$$;
create function pg_temp.id_of(p_title text) returns uuid language sql security definer as $$ select id from public.brand_documents where title = p_title $$;
create function pg_temp.frag(p_title text, p_pos integer, p_content text, p_section text default null) returns void language sql as $$
  insert into public.brand_document_fragments (tenant_id, brand_id, document_id, position, section_ref, content)
  select d.tenant_id, d.brand_id, d.id, p_pos, p_section, p_content from public.brand_documents d where d.id = pg_temp.id_of(p_title)
$$;
create function pg_temp.found(p_query text, p_on date default '2026-06-01', p_brand uuid default '20000000-0000-0000-0000-000000000011') returns text[] language sql as $$
  select coalesce(array_agg(x ->> 'title' order by x ->> 'title'), '{}') from jsonb_array_elements(public.brand_document_search(p_brand, p_query, p_on, 10)) x
$$;

-- D1. Cine scrie un document ---------------------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select throws_ok($$ select pg_temp.doc('Document de client', '30000000-0000-0000-0000-000000000004') $$, '42501', null, 'D1: clientul nu introduce documente');
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select throws_ok($$ select pg_temp.doc('Fără acces la brand', '30000000-0000-0000-0000-000000000003') $$, '42501', null, 'D1: account fără acces la brand');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select pg_temp.doc('Alt client', '30000000-0000-0000-0000-000000000011') $$, '42501', null, 'D1: adminul altui client');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ select pg_temp.doc('Autor fals', '30000000-0000-0000-0000-000000000001') $$, '42501', null, 'D1: autorul nu poate fi alt utilizator');
select lives_ok($$ select pg_temp.doc('Prospect', '30000000-0000-0000-0000-000000000002') $$, 'D1: strategistul introduce un document');
select is((select status from public.brand_documents where title = 'Prospect'), 'draft', 'D1: introducerea nu aprobă documentul');
select throws_ok($$ insert into public.brand_documents (tenant_id, brand_id, title, doc_type, country, language, version, created_by)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Tip necunoscut', 'altceva', 'RO', 'ro', '1', '30000000-0000-0000-0000-000000000002') $$, '23514', null, 'D1: tipul are valori fixe');
select throws_ok($$ insert into public.brand_documents (tenant_id, brand_id, title, doc_type, country, language, version, created_by, valid_from, valid_to)
  values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000011', 'Interval inversat', 'faq', 'RO', 'ro', '1', '30000000-0000-0000-0000-000000000002', '2026-06-01', '2026-01-01') $$, '23514', null, 'D1: valabilitatea nu se termină înainte să înceapă');

-- D2. Un document nou nu intră în context până nu e aprobat -------------------------------------------------------------------
select lives_ok($$ select pg_temp.frag('Prospect', 1, 'Doza recomandată pentru adulți este de un comprimat pe zi.', 'Administrare') $$, 'D2: textul se adaugă cât documentul e ciornă');
select lives_ok($$ select pg_temp.frag('Prospect', 2, 'Produsul se păstrează la temperatura camerei, ferit de umezeală.', 'Păstrare') $$, 'D2: al doilea fragment');
select throws_ok($$ select pg_temp.frag('Prospect', 2, 'Poziție dublă.') $$, '23505', null, 'D2: o poziție are un singur fragment');
select is(pg_temp.found('Care este doza recomandată?'), '{}'::text[], 'D2: ciorna nu apare în căutare');
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select count(*) from public.brand_documents), 0::bigint, 'D2: clientul nu vede ciorna');
select is((select count(*) from public.brand_document_fragments), 0::bigint, 'D2: nici textul ei');

-- D3. Aprobarea: doar strategist sau agency_admin, cu responsabil, valabilitate și text --------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ select pg_temp.doc('Fără text', '30000000-0000-0000-0000-000000000002') $$, 'D3: document fără text');
select throws_ok($$ update public.brand_documents set status = 'approved' where title = 'Fără text' $$, '23514', null, 'D3: un document fără text nu se aprobă');
select lives_ok($$ select pg_temp.doc('Fără responsabil', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', null) $$, 'D3: document fără responsabil');
select pg_temp.frag('Fără responsabil', 1, 'Text oarecare despre doza zilnică.');
select throws_ok($$ update public.brand_documents set status = 'approved' where title = 'Fără responsabil' $$, '23514', null, 'D3: aprobarea cere responsabilul de la brand');
select throws_ok($$ update public.brand_documents set status = 'retired' where title = 'Prospect' $$, '23514', null, 'D3: o ciornă nu se retrage; se șterge');
select throws_ok($$ update public.brand_documents set approved_at = now() where title = 'Prospect' $$, '42501', null, 'D3: data aprobării nu se scrie direct');
select lives_ok($$ update public.brand_documents set status = 'approved' where title = 'Prospect' $$, 'D3: strategistul aprobă');
select is((select approved_by from public.brand_documents where title = 'Prospect'), '30000000-0000-0000-0000-000000000002'::uuid, 'D3: aprobarea are un om care răspunde de ea');
select isnt((select approved_at from public.brand_documents where title = 'Prospect'), null, 'D3: și o dată');

-- account poate introduce, dar nu aproba (pe brandul lui, 1B).
select tests.authenticate_as('30000000-0000-0000-0000-000000000003');
select lives_ok($$ select pg_temp.doc('Ghid 1B', '30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000012') $$, 'D3: account introduce un document pe brandul lui');
select pg_temp.frag('Ghid 1B', 1, 'Tonul comunicării este cald și direct, fără promisiuni despre doza zilnică.');
select throws_ok($$ update public.brand_documents set status = 'approved' where title = 'Ghid 1B' $$, '42501', null, 'D3: account nu aprobă');

-- D4. Un document aprobat nu se mai schimbă -------------------------------------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.brand_documents set title = 'Prospect modificat' where title = 'Prospect' $$, '42501', null, 'D4: titlul nu se editează după aprobare');
select throws_ok($$ update public.brand_documents set valid_to = '2030-01-01' where title = 'Prospect' $$, '42501', null, 'D4: nici valabilitatea');
select throws_ok($$ select pg_temp.frag('Prospect', 3, 'Text adăugat după aprobare.') $$, '42501', null, 'D4: nu se adaugă text după aprobare');
select throws_ok($$ delete from public.brand_document_fragments where document_id = pg_temp.id_of('Prospect') $$, '42501', null, 'D4: nu se șterge text după aprobare');
delete from public.brand_documents where title = 'Prospect';
select is((select status from public.brand_documents where title = 'Prospect'), 'approved', 'D4: un document aprobat nu se șterge (RLS nu îl oferă ștergerii)');
select tests.authenticate_as_service_role();
select throws_ok($$ delete from public.brand_documents where title = 'Prospect' $$, '42501', null, 'D4: nici cheia de service nu îl șterge');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select throws_ok($$ update public.brand_documents set status = 'draft' where title = 'Prospect' $$, '23514', null, 'D4: un document aprobat nu redevine ciornă');
select tests.authenticate_as_service_role();
select throws_ok($$ update public.brand_documents set title = 'Rescris de server' where title = 'Prospect' $$, '42501', null, 'D4: nici cheia de service nu editează un document aprobat');
select throws_ok($$ update public.brand_document_fragments set content = 'Doza este de zece comprimate.' where document_id = pg_temp.id_of('Prospect') $$, '42501', null, 'D4: nici cheia de service nu rescrie textul aprobat');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select lives_ok($$ delete from public.brand_documents where title = 'Fără text' $$, 'D4: o ciornă se poate șterge');
select lives_ok($$ delete from public.brand_documents where title = 'Fără responsabil' $$, 'D4: o ciornă cu text se șterge împreună cu textul ei');
select is((select count(*) from public.brand_document_fragments where content like 'Text oarecare%'), 0::bigint, 'D4: fragmentele ciornei șterse nu rămân');

-- D5. Căutarea: doar documente aprobate și valabile la data cerută ---------------------------------------------------------------
select is(pg_temp.found('Care este doza recomandată?'), array['Prospect'], 'D5: documentul aprobat apare');
select is(pg_temp.found('care este DOZA recomandata'), array['Prospect'], 'D5: fără diacritice și fără majuscule');
select is(pg_temp.found('Cum se păstrează produsul?'), array['Prospect'], 'D5: alt fragment al aceluiași document');
select is(public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată', '2026-06-01', 10) -> 0 ->> 'section_ref', 'Administrare', 'D5: fragmentul vine cu secțiunea lui');
select is(public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată', '2026-06-01', 10) -> 0 ->> 'version', '1.0', 'D5: și cu versiunea documentului');
select is(pg_temp.found('rezervare la hotel'), '{}'::text[], 'D5: fără cuvinte comune, nu vine nimic');
select is(pg_temp.found('ce la de'), '{}'::text[], 'D5: doar cuvinte scurte: nu vine nimic');
select is(pg_temp.found(''), '{}'::text[], 'D5: întrebare goală');
select is(pg_temp.found($q$doza'); drop table public.brand_documents; --$q$), array['Prospect'], 'D5: întrebarea e text, nu SQL');
select is(pg_temp.found('doza recomandată', '2025-12-31'), '{}'::text[], 'D5: înainte de începutul valabilității nu intră în context');

select pg_temp.doc('Prospect vechi', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000011', 'Medical', '2025-01-01', '2025-12-31');
select pg_temp.frag('Prospect vechi', 1, 'Doza recomandată era de două comprimate pe zi.');
update public.brand_documents set status = 'approved' where title = 'Prospect vechi';
select is(pg_temp.found('doza recomandată', '2026-06-01'), array['Prospect'], 'D5: documentul expirat nu intră în context');
select is(pg_temp.found('doza recomandată', '2025-06-01'), array['Prospect vechi'], 'D5: la o dată din valabilitatea lui, intră doar el');
select is(jsonb_array_length(public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată produsul temperatura', '2026-06-01', 1)), 1, 'D5: limita taie lista');

-- D6. Retragerea scoate documentul din context, dar îl păstrează --------------------------------------------------------------
select lives_ok($$ update public.brand_documents set status = 'retired' where title = 'Prospect vechi' $$, 'D6: strategistul retrage documentul');
select is(pg_temp.found('doza recomandată', '2025-06-01'), '{}'::text[], 'D6: documentul retras nu mai intră în context');
select is((select count(*) from public.brand_documents where title = 'Prospect vechi'), 1::bigint, 'D6: rămâne în istoric');
select throws_ok($$ update public.brand_documents set status = 'approved' where title = 'Prospect vechi' $$, '23514', null, 'D6: un document retras nu se reaprobă; se adaugă o versiune nouă');
select throws_ok($$ update public.brand_documents set status = 'retired', title = 'Alt titlu' where title = 'Prospect' $$, '42501', null, 'D6: retragerea nu schimbă conținutul');

-- D7. Clientul vede documentele aprobate ale brandului lui, nimic altceva --------------------------------------------------------
select tests.authenticate_as('30000000-0000-0000-0000-000000000004');
select is((select array_agg(title order by title) from public.brand_documents), array['Prospect'], 'D7: clientul vede doar documentul aprobat (nu ciorne, nu retrase)');
select is((select count(*) from public.brand_document_fragments), 2::bigint, 'D7: și textul lui');
select is(pg_temp.found('doza recomandată'), array['Prospect'], 'D7: căutarea merge și pentru client');
update public.brand_documents set status = 'retired' where title = 'Prospect';
select is((select status from public.brand_documents where title = 'Prospect'), 'approved', 'D7: clientul nu retrage (RLS nu îi oferă rândul la scriere)');
delete from public.brand_document_fragments;
select is((select count(*) from public.brand_document_fragments), 2::bigint, 'D7: clientul nu șterge text');
select throws_ok($$ select pg_temp.frag('Prospect', 9, 'Text de la client.') $$, '42501', null, 'D7: clientul nu adaugă text');

-- D8. Izolare -------------------------------------------------------------------------------------------------------------------
select throws_ok($$ select public.brand_document_search('20000000-0000-0000-0000-000000000012', 'doza zilnică', null, 5) $$, '42501', null, 'D8: clientul nu caută în alt brand al aceluiași client');
select tests.authenticate_as('30000000-0000-0000-0000-000000000011');
select throws_ok($$ select public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată', null, 5) $$, '42501', null, 'D8: alt client nu caută');
select is((select count(*) from public.brand_documents), 0::bigint, 'D8: alt client nu vede documente');
select is((select count(*) from public.brand_document_fragments), 0::bigint, 'D8: nici fragmente');
select tests.authenticate_as('30000000-0000-0000-0000-000000000005');
select throws_ok($$ select public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată', null, 5) $$, '42501', null, 'D8: client fără acces la brand');
select tests.authenticate_as_anon();
select throws_ok($$ select public.brand_document_search('20000000-0000-0000-0000-000000000011', 'doza recomandată', null, 5) $$, '42501', null, 'D8: anon nu caută');
-- Strategistul lui 1A nu găsește documentele lui 1B, nici măcar aprobate.
select tests.authenticate_as('30000000-0000-0000-0000-000000000001');
update public.brand_documents set status = 'approved' where title = 'Ghid 1B';
select is(pg_temp.found('doza zilnică', '2026-06-01', '20000000-0000-0000-0000-000000000012'), array['Ghid 1B'], 'D8: adminul găsește documentul lui 1B în 1B');
select is(pg_temp.found('tonul comunicării promisiuni', '2026-06-01'), '{}'::text[], 'D8: căutarea în 1A nu întoarce fragmente din 1B');
select tests.authenticate_as('30000000-0000-0000-0000-000000000002');
select is((select count(*) from public.brand_documents where title = 'Ghid 1B'), 0::bigint, 'D8: strategistul lui 1A nu vede documentul lui 1B');

-- D9. Audit ---------------------------------------------------------------------------------------------------------------------
reset role;
select ok((select count(*) from public.audit_events where entity_type = 'brand_documents') >= 6, 'D9: introducerea, aprobarea, retragerea și ștergerea rămân în audit');
select is((select count(*) from public.audit_events where entity_type = 'brand_document_fragments'), 0::bigint, 'D9: textul fragmentelor nu se dublează în audit');

select * from finish();
rollback;
