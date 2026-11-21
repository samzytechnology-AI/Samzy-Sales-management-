-- Transactional CRM conversion and traceability for the Business Command Centre.
-- Apply only to the dedicated Samzy Business Command Centre Supabase project.

alter table public.clients
  add column if not exists source_prospect_id uuid references public.prospects(id) on delete set null;
create unique index if not exists clients_org_source_prospect_unique
  on public.clients(organization_id, source_prospect_id)
  where source_prospect_id is not null;

create or replace function public.convert_prospect_to_client(
  p_organization_id uuid,
  p_prospect_id uuid,
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prospect public.prospects%rowtype;
  v_client public.clients%rowtype;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_actor_user_id
      and role in ('owner','admin','manager')
  ) then
    raise exception 'Not authorised to convert prospects in this company';
  end if;

  select * into v_prospect
  from public.prospects
  where id = p_prospect_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Prospect not found in this company';
  end if;

  select * into v_client
  from public.clients
  where organization_id = p_organization_id
    and source_prospect_id = p_prospect_id;

  if not found then
    insert into public.clients (
      organization_id, company_name, website_url, industry, notes, source_prospect_id
    ) values (
      p_organization_id, v_prospect.company_name, v_prospect.website_url,
      v_prospect.industry, v_prospect.research_summary, p_prospect_id
    )
    returning * into v_client;
  end if;

  update public.prospects
  set status = 'customer', updated_at = now()
  where id = p_prospect_id and organization_id = p_organization_id;

  insert into public.audit_events (
    organization_id, actor_user_id, actor_type, action, entity_type, entity_id, metadata
  ) values (
    p_organization_id, p_actor_user_id, 'user', 'crm.prospect.converted',
    'client', v_client.id,
    jsonb_build_object('prospect_id', p_prospect_id, 'company_name', v_prospect.company_name)
  );

  return to_jsonb(v_client);
end;
$$;

revoke all on function public.convert_prospect_to_client(uuid, uuid, uuid) from public;
revoke all on function public.convert_prospect_to_client(uuid, uuid, uuid) from anon;
revoke all on function public.convert_prospect_to_client(uuid, uuid, uuid) from authenticated;
grant execute on function public.convert_prospect_to_client(uuid, uuid, uuid) to service_role;
