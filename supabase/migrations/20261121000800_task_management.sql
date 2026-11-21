-- Organisation-scoped task management for Samzy Business Command Centre only.
-- Apply after migrations 001-007 to the dedicated Business Command Centre project.

create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 2 and 180),
  description text,
  status text not null default 'open' check (status in ('open','in_progress','blocked','completed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  due_at timestamptz,
  project_id uuid references public.projects(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tasks_org_status_due_idx
  on public.tasks(organization_id,status,due_at asc nulls last,created_at desc);
create index if not exists tasks_org_project_idx on public.tasks(organization_id,project_id);
alter table public.tasks enable row level security;
create policy "members manage organisation tasks" on public.tasks for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));

-- The application accesses tasks through authenticated server routes using the service role.
-- Do not grant anon access; RLS remains enabled for any future authenticated direct access.
grant select, insert, update, delete on table public.tasks to service_role;

create or replace function public.enforce_task_link_organisation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.project_id is not null and not exists (
    select 1 from public.projects where id = new.project_id and organization_id = new.organization_id
  ) then raise exception 'Task project must belong to the same organisation'; end if;
  if new.client_id is not null and not exists (
    select 1 from public.clients where id = new.client_id and organization_id = new.organization_id
  ) then raise exception 'Task client must belong to the same organisation'; end if;
  if new.prospect_id is not null and not exists (
    select 1 from public.prospects where id = new.prospect_id and organization_id = new.organization_id
  ) then raise exception 'Task prospect must belong to the same organisation'; end if;
  return new;
end;
$$;

drop trigger if exists tasks_enforce_link_organisation on public.tasks;
create trigger tasks_enforce_link_organisation
  before insert or update of organization_id, project_id, client_id, prospect_id
  on public.tasks
  for each row execute function public.enforce_task_link_organisation();

revoke all on function public.enforce_task_link_organisation() from public;
revoke all on function public.enforce_task_link_organisation() from anon;
revoke all on function public.enforce_task_link_organisation() from authenticated;
grant execute on function public.enforce_task_link_organisation() to service_role;
