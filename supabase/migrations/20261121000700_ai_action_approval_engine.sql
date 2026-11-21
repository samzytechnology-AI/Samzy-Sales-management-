-- Controlled AI action requests for Samzy Business Command Centre only.
-- Apply only after migrations 001-006, to the dedicated Business Command Centre project.

create table if not exists public.ai_action_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  requested_by uuid not null references auth.users(id),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  approved_by uuid references auth.users(id),
  action_type text not null check (action_type in (
    'create_prospect','update_prospect_status','create_project',
    'update_project_status','create_approval_request'
  )),
  summary text not null check (char_length(summary) between 5 and 240),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending_approval'
    check (status in ('pending_approval','executed','rejected','failed','expired')),
  idempotency_key uuid not null,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  decided_at timestamptz,
  execution_result jsonb,
  failure_reason text,
  created_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);
create index if not exists ai_action_requests_org_status_idx
  on public.ai_action_requests(organization_id, status, created_at desc);
alter table public.ai_action_requests enable row level security;
create policy "members read own organisation action requests"
  on public.ai_action_requests for select
  using (public.can_access_company_ai(organization_id));

create or replace function public.review_ai_action_request(
  p_organization_id uuid,
  p_action_request_id uuid,
  p_actor_user_id uuid,
  p_decision text,
  p_decision_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request public.ai_action_requests%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_id uuid;
  v_status text;
begin
  if p_decision not in ('approved','rejected') then
    raise exception 'Unsupported decision';
  end if;

  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_actor_user_id
      and role in ('owner','admin')
  ) then
    raise exception 'Only an organisation owner or administrator may decide AI actions';
  end if;

  select * into v_request
  from public.ai_action_requests
  where id = p_action_request_id
    and organization_id = p_organization_id
  for update;

  if not found then raise exception 'Action request not found'; end if;
  if v_request.status <> 'pending_approval' then
    raise exception 'Action request is no longer pending';
  end if;

  if v_request.expires_at <= now() then
    update public.ai_action_requests
      set status = 'expired', decided_at = now()
      where id = v_request.id;
    return jsonb_build_object('id',v_request.id,'status','expired');
  end if;

  if p_decision = 'rejected' then
    update public.ai_action_requests
      set status = 'rejected', approved_by = p_actor_user_id,
          decided_at = now(), failure_reason = left(coalesce(p_decision_note,''),1000)
      where id = v_request.id;
    insert into public.audit_events(organization_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
      values(p_organization_id,p_actor_user_id,'user','ai_action.rejected','ai_action_request',v_request.id,
        jsonb_build_object('action_type',v_request.action_type,'note',left(coalesce(p_decision_note,''),1000)));
    return jsonb_build_object('id',v_request.id,'status','rejected');
  end if;

  v_payload := v_request.payload;
  v_id := null;
  case v_request.action_type
    when 'create_prospect' then
      insert into public.prospects(organization_id,company_name,website_url,industry,country,fit_score,research_summary)
      values(p_organization_id, v_payload->>'company_name', nullif(v_payload->>'website_url',''),
        nullif(v_payload->>'industry',''), nullif(v_payload->>'country',''),
        nullif(v_payload->>'fit_score','')::integer, nullif(v_payload->>'research_summary',''))
      returning id into v_id;
    when 'update_prospect_status' then
      update public.prospects
      set status=v_payload->>'status', updated_at=now()
      where id=(v_payload->>'prospect_id')::uuid
        and organization_id=p_organization_id
        and (v_payload->>'status') in ('discovered','researching','qualified','contacted','replied','opportunity','disqualified')
      returning id into v_id;
      if v_id is null then raise exception 'Prospect was not found in this organisation or status is invalid'; end if;
    when 'create_project' then
      if nullif(v_payload->>'client_id','') is not null and not exists(
        select 1 from public.clients where id=(v_payload->>'client_id')::uuid and organization_id=p_organization_id
      ) then raise exception 'Linked client does not belong to this organisation'; end if;
      if nullif(v_payload->>'prospect_id','') is not null and not exists(
        select 1 from public.prospects where id=(v_payload->>'prospect_id')::uuid and organization_id=p_organization_id
      ) then raise exception 'Linked prospect does not belong to this organisation'; end if;
      if nullif(v_payload->>'product_id','') is not null and not exists(
        select 1 from public.product_registry where id=(v_payload->>'product_id')::uuid and organization_id=p_organization_id
      ) then raise exception 'Linked product does not belong to this organisation'; end if;
      insert into public.projects(organization_id,project_name,status,quoted_amount_ngn,due_at,client_id,prospect_id,product_id)
      values(p_organization_id,v_payload->>'project_name',coalesce(nullif(v_payload->>'status',''),'planned'),
        nullif(v_payload->>'quoted_amount_ngn','')::bigint,nullif(v_payload->>'due_at','')::timestamptz,
        nullif(v_payload->>'client_id','')::uuid,nullif(v_payload->>'prospect_id','')::uuid,nullif(v_payload->>'product_id','')::uuid)
      returning id into v_id;
    when 'update_project_status' then
      update public.projects
      set status=v_payload->>'status',updated_at=now()
      where id=(v_payload->>'project_id')::uuid and organization_id=p_organization_id
        and (v_payload->>'status') in ('planned','in_progress','blocked','review','delivered','cancelled')
      returning id into v_id;
      if v_id is null then raise exception 'Project was not found in this organisation or status is invalid'; end if;
    when 'create_approval_request' then
      insert into public.approval_requests(organization_id,title,description,category,requested_by)
      values(p_organization_id,v_payload->>'title',v_payload->>'description',
        coalesce(nullif(v_payload->>'category',''),'other'),v_request.requested_by)
      returning id into v_id;
    else
      raise exception 'Unsupported action type';
  end case;

  v_result := jsonb_build_object('record_id',v_id,'action_type',v_request.action_type);
  update public.ai_action_requests
    set status='executed',approved_by=p_actor_user_id,decided_at=now(),execution_result=v_result
    where id=v_request.id;

  insert into public.audit_events(organization_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
    values(p_organization_id,p_actor_user_id,'user','ai_action.executed','ai_action_request',v_request.id,
      jsonb_build_object('action_type',v_request.action_type,'result',v_result,'note',left(coalesce(p_decision_note,''),1000)));
  return jsonb_build_object('id',v_request.id,'status','executed','result',v_result);
exception when others then
  if v_request.id is null then
    raise;
  end if;
  if v_request.id is not null then
    update public.ai_action_requests
      set status='failed',approved_by=p_actor_user_id,decided_at=now(),failure_reason=left(sqlerrm,1000)
      where id=v_request.id and status='pending_approval';
    insert into public.audit_events(organization_id,actor_user_id,actor_type,action,entity_type,entity_id,metadata)
      values(p_organization_id,p_actor_user_id,'user','ai_action.execution_failed','ai_action_request',v_request.id,
        jsonb_build_object('action_type',v_request.action_type,'reason',left(sqlerrm,1000)));
  end if;
  raise;
end;
$$;

revoke all on function public.review_ai_action_request(uuid,uuid,uuid,text,text) from public;
revoke all on function public.review_ai_action_request(uuid,uuid,uuid,text,text) from anon;
revoke all on function public.review_ai_action_request(uuid,uuid,uuid,text,text) from authenticated;
grant execute on function public.review_ai_action_request(uuid,uuid,uuid,text,text) to service_role;
