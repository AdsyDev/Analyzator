-- SEOmonitor (D-26, 26 oct. 2026): originalele răspunsurilor AI se rescriau integral la fiecare rulare (fereastra de 35
-- de zile se suprapune de la o săptămână la alta), iar actualizarea textelor mari depășea statement_timeout (57014).
-- Pe 20 oct. 2026, un timeout pe primul site a oprit colectarea tuturor site-urilor clientului.
-- Hash-ul conținutului (sha256 al `raw_content`) îi permite conectorului să scrie doar originalele noi sau schimbate.
-- NULL = rând scris înainte de această migrație; primește hash-ul la prima rescriere. Politicile RLS nu se schimbă.
alter table public.ai_answer_originals
  add column content_sha256 text check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');
