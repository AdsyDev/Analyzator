-- Alertele de refresh se trimit și pentru rulările parțiale (o sursă cu date lipsă pe care cineva trebuie s-o vadă).
-- kind: refresh_failed (rulare eșuată sau excepție) · refresh_partial (rulare parțială). Cheia unică (sync_run_id, kind) rămâne.
alter table public.ops_notifications drop constraint ops_notifications_kind_check;
alter table public.ops_notifications add constraint ops_notifications_kind_check
  check (kind in ('refresh_failed', 'refresh_partial'));
