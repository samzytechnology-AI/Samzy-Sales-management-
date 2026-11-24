create table if not exists public.prospect_discovery_state (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  next_task_index bigint not null default 0 check (next_task_index >= 0),
  total_searches bigint not null default 0 check (total_searches >= 0),
  total_saved bigint not null default 0 check (total_saved >= 0),
  last_run_at timestamptz,
  last_saved_count integer not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.prospect_discovery_state enable row level security;
grant all on public.prospect_discovery_state to service_role;

create unique index if not exists prospects_org_company_name_ci_unique
  on public.prospects (organization_id, lower(trim(company_name)));

create index if not exists prospects_org_created_at_desc_idx
  on public.prospects (organization_id, created_at desc);
