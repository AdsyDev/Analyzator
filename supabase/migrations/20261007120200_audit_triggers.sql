-- ANZ05: audit automat pe tabelele de configurare și import.
-- Actorul: utilizatorul din JWT; pentru importurile scrise de worker, uploaded_by.

create function private.audit_row() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row       jsonb := to_jsonb(coalesce(new, old));
  v_tenant_id uuid;
  v_brand_id  uuid;
  v_actor     uuid := (select auth.uid());
begin
  if tg_table_name = 'tenants' then
    v_tenant_id := (v_row ->> 'id')::uuid;
  else
    v_tenant_id := (v_row ->> 'tenant_id')::uuid;
  end if;

  if tg_table_name = 'brands' then
    v_brand_id := (v_row ->> 'id')::uuid;
  else
    v_brand_id := (v_row ->> 'brand_id')::uuid;
  end if;

  insert into public.audit_events (
    tenant_id, brand_id, actor_user_id, actor_type, action, entity_type, entity_id, before, after
  ) values (
    v_tenant_id,
    v_brand_id,
    coalesce(v_actor, (v_row ->> 'uploaded_by')::uuid),
    case
      when v_actor is not null then 'user'
      when (select auth.role()) = 'service_role' then 'worker'
      else 'system'
    end,
    lower(tg_op),
    tg_table_name,
    v_row ->> 'id',
    case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end,
    case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end
  );

  return null;
end;
$$;

revoke all on function private.audit_row() from public, anon, authenticated;

create trigger tenants_audit after insert or update or delete on public.tenants
  for each row execute function private.audit_row();
create trigger brands_audit after insert or update or delete on public.brands
  for each row execute function private.audit_row();
create trigger memberships_audit after insert or update or delete on public.memberships
  for each row execute function private.audit_row();
create trigger brand_access_audit after insert or update or delete on public.brand_access
  for each row execute function private.audit_row();
create trigger competitor_sets_audit after insert on public.competitor_sets
  for each row execute function private.audit_row();
create trigger competitor_set_members_audit after insert on public.competitor_set_members
  for each row execute function private.audit_row();
create trigger source_connections_audit after insert or update or delete on public.source_connections
  for each row execute function private.audit_row();
create trigger import_batches_audit after insert or update on public.import_batches
  for each row execute function private.audit_row();
