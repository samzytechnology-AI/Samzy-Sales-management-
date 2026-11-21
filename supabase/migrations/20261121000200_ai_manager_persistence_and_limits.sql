-- AI General Manager persistence, audit attribution and server-side rate limiting.
-- Apply only to the dedicated Samzy Business Command Centre Supabase project.

alter table public.ai_runs
  add column if not exists actor_user_id uuid references auth.users(id),
  add column if not exists synthesis text,
  add column if not exists request_metadata jsonb not null default '{}'::jsonb;

create table if not exists public.ai_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null default 'New company conversation',
  status text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ai_conversations_org_updated_idx
  on public.ai_conversations(organization_id, updated_at desc);

create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null check (length(content) <= 20000),
  ai_run_id uuid references public.ai_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_conversation_created_idx
  on public.ai_messages(conversation_id, created_at);

create table if not exists public.ai_rate_limit_windows (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  request_count integer not null default 0 check (request_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id, window_start)
);
create index if not exists ai_rate_limit_cleanup_idx
  on public.ai_rate_limit_windows(window_start);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_rate_limit_windows enable row level security;

create policy "members read own company conversations"
  on public.ai_conversations for select
  using (public.is_org_member(organization_id) and created_by = auth.uid());
create policy "members create own company conversations"
  on public.ai_conversations for insert
  with check (public.is_org_member(organization_id) and created_by = auth.uid());
create policy "members update own company conversations"
  on public.ai_conversations for update
  using (public.is_org_member(organization_id) and created_by = auth.uid())
  with check (public.is_org_member(organization_id) and created_by = auth.uid());

create policy "members read messages in own company conversations"
  on public.ai_messages for select
  using (
    public.is_org_member(organization_id)
    and exists (
      select 1 from public.ai_conversations c
      where c.id = conversation_id
        and c.organization_id = ai_messages.organization_id
        and c.created_by = auth.uid()
    )
  );
-- Writes to AI messages and rate-limit windows are server-only through the service role.

create or replace function public.consume_ai_rate_limit(
  p_organization_id uuid,
  p_user_id uuid,
  p_limit integer default 30,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window_start timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_limit > 1000 or p_window_seconds < 60 or p_window_seconds > 86400 then
    raise exception 'Invalid rate limit configuration';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.ai_rate_limit_windows (
    organization_id, user_id, window_start, request_count, updated_at
  ) values (
    p_organization_id, p_user_id, v_window_start, 1, now()
  )
  on conflict (organization_id, user_id, window_start)
  do update set
    request_count = public.ai_rate_limit_windows.request_count + 1,
    updated_at = now()
  where public.ai_rate_limit_windows.request_count < p_limit
  returning request_count into v_count;

  return found;
end;
$$;

revoke all on function public.consume_ai_rate_limit(uuid, uuid, integer, integer) from public;
revoke all on function public.consume_ai_rate_limit(uuid, uuid, integer, integer) from anon;
revoke all on function public.consume_ai_rate_limit(uuid, uuid, integer, integer) from authenticated;
grant execute on function public.consume_ai_rate_limit(uuid, uuid, integer, integer) to service_role;

-- The service role bypasses RLS; browser clients cannot read or alter usage counters.
