-- Shared company-wide AI General Manager conversation.
-- Apply only to the dedicated Samzy Business Command Centre Supabase project.

alter table public.ai_conversations
  add column if not exists scope text not null default 'personal'
  check (scope in ('personal','company'));

alter table public.ai_messages
  add column if not exists actor_user_id uuid references auth.users(id) on delete set null;
create index if not exists ai_messages_actor_created_idx
  on public.ai_messages(organization_id, actor_user_id, created_at desc);

create or replace function public.can_access_company_ai(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $
  select exists (
    select 1 from public.organization_members
    where organization_id = target_org
      and user_id = auth.uid()
      and role in ('owner','admin','manager')
  );
$;
revoke all on function public.can_access_company_ai(uuid) from public;
revoke all on function public.can_access_company_ai(uuid) from anon;
grant execute on function public.can_access_company_ai(uuid) to authenticated;
grant execute on function public.can_access_company_ai(uuid) to service_role;

create unique index if not exists ai_conversations_one_active_company_idx
  on public.ai_conversations(organization_id)
  where scope = 'company' and status = 'active';

drop policy if exists "members read own company conversations" on public.ai_conversations;
drop policy if exists "members create own company conversations" on public.ai_conversations;
drop policy if exists "members update own company conversations" on public.ai_conversations;
drop policy if exists "members read messages in own company conversations" on public.ai_messages;

create policy "members read permitted company conversations"
  on public.ai_conversations for select
  using (
    public.can_access_company_ai(organization_id)
    and (scope = 'company' or created_by = auth.uid())
  );

create policy "members create company conversations"
  on public.ai_conversations for insert
  with check (
    public.can_access_company_ai(organization_id)
    and created_by = auth.uid()
  );

create policy "members update permitted company conversations"
  on public.ai_conversations for update
  using (
    public.can_access_company_ai(organization_id)
    and (scope = 'company' or created_by = auth.uid())
  )
  with check (
    public.can_access_company_ai(organization_id)
    and (scope = 'company' or created_by = auth.uid())
  );

create policy "members read messages in permitted company conversations"
  on public.ai_messages for select
  using (
    public.can_access_company_ai(organization_id)
    and exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id
        and c.organization_id = ai_messages.organization_id
        and (c.scope = 'company' or c.created_by = auth.uid())
    )
  );

create or replace function public.get_or_create_company_ai_conversation(
  p_organization_id uuid,
  p_user_id uuid,
  p_title text default 'Samzy Technology — AI General Manager'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_conversation_id uuid;
begin
  if not exists (
    select 1 from public.organization_members
    where organization_id = p_organization_id
      and user_id = p_user_id
      and role in ('owner','admin','manager')
  ) then
    raise exception 'Not authorised to access the company AI conversation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 0));

  select id into v_conversation_id
  from public.ai_conversations
  where organization_id = p_organization_id
    and scope = 'company'
    and status = 'active'
  limit 1;

  if v_conversation_id is null then
    insert into public.ai_conversations (
      organization_id, created_by, title, scope, status
    ) values (
      p_organization_id, p_user_id, left(p_title, 80), 'company', 'active'
    )
    returning id into v_conversation_id;
  end if;

  return v_conversation_id;
end;
$$;

revoke all on function public.get_or_create_company_ai_conversation(uuid, uuid, text) from public;
revoke all on function public.get_or_create_company_ai_conversation(uuid, uuid, text) from anon;
revoke all on function public.get_or_create_company_ai_conversation(uuid, uuid, text) from authenticated;
grant execute on function public.get_or_create_company_ai_conversation(uuid, uuid, text) to service_role;
