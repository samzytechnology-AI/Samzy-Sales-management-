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
  updated_at timestamptz not null default now(),
  check (project_id is not null or client_id is not null or prospect_id is not null or title is not null)
);
create index if not exists tasks_org_status_due_idx
  on public.tasks(organization_id,status,due_at asc nulls last,created_at desc);
create index if not exists tasks_org_project_idx on public.tasks(organization_id,project_id);
alter table public.tasks enable row level security;
create policy "members manage organisation tasks" on public.tasks for all
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
