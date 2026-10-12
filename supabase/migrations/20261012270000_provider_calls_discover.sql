-- Selectorul de conturi din pagina site-ului (D-18): funcția `source-credentials` listează conturile pe care le vede
-- cheia clientului (proprietăți GA4, site-uri Search Console, workspace-uri Planable, conturi Meta, campanii SEOmonitor).
-- Listarea se contorizează separat de colectare și de testul tokenului, cu limita ei zilnică (în funcție).

alter table public.provider_api_calls drop constraint provider_api_calls_purpose_check;
alter table public.provider_api_calls
  add constraint provider_api_calls_purpose_check check (purpose in ('collect', 'validate', 'discover'));
