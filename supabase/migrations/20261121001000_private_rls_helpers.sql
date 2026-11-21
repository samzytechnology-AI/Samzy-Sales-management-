-- Keep SECURITY DEFINER helpers outside the exposed public API schema.
-- RLS policies can call these private helpers without exposing RPC endpoints.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.is_org_member(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members m
    where m.organization_id = target_org and m.user_id = auth.uid()
  );
$$;

create or replace function private.can_access_company_ai(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role in ('owner','admin','manager')
  );
$$;

revoke all on function private.is_org_member(uuid) from public, anon;
revoke all on function private.can_access_company_ai(uuid) from public, anon;
grant execute on function private.is_org_member(uuid) to authenticated, service_role;
grant execute on function private.can_access_company_ai(uuid) to authenticated, service_role;

-- Replace policies to call private helpers.
alter policy "members read organizations" on public.organizations
  using (private.is_org_member(id));
alter policy "members read membership" on public.organization_members
  using (private.is_org_member(organization_id));
alter policy "members manage memory" on public.company_memory
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage pricing" on public.pricing_policies
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage prospects" on public.prospects
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage contacts" on public.contact_points
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage suppression" on public.suppression_list
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage outreach" on public.outreach_events
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage products" on public.product_registry
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage projects" on public.projects
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members read ai runs" on public.ai_runs
  using (private.is_org_member(organization_id));
alter policy "members read audit" on public.audit_events
  using (private.is_org_member(organization_id));
alter policy "members manage clients" on public.clients
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage financial transactions" on public.financial_transactions
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage approval requests" on public.approval_requests
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
alter policy "members manage organisation tasks" on public.tasks
  using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));

alter policy "members read permitted company conversations" on public.ai_conversations
  using (private.can_access_company_ai(organization_id) and (scope = 'company' or created_by = auth.uid()));
alter policy "members create company conversations" on public.ai_conversations
  with check (private.can_access_company_ai(organization_id) and created_by = auth.uid());
alter policy "members update permitted company conversations" on public.ai_conversations
  using (private.can_access_company_ai(organization_id) and (scope = 'company' or created_by = auth.uid()))
  with check (private.can_access_company_ai(organization_id) and (scope = 'company' or created_by = auth.uid()));
alter policy "members read messages in permitted company conversations" on public.ai_messages
  using (
    private.can_access_company_ai(organization_id)
    and exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id
        and c.organization_id = ai_messages.organization_id
        and (c.scope = 'company' or c.created_by = auth.uid())
    )
  );
alter policy "members read own organisation action requests" on public.ai_action_requests
  using (private.can_access_company_ai(organization_id));

-- The old public-schema helpers are no longer used by policies.
revoke all on function public.is_org_member(uuid) from public, anon, authenticated;
revoke all on function public.can_access_company_ai(uuid) from public, anon, authenticated;
