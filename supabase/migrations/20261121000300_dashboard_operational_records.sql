-- Live operational records for the Business Command Centre dashboard.
-- Apply only to the dedicated Samzy Business Command Centre Supabase project.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null,
  primary_contact_name text,
  email text,
  phone text,
  website_url text,
  industry text,
  status text not null default 'active' check (status in ('active','inactive','on_hold')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists clients_org_status_idx on public.clients(organization_id,status,created_at desc);
create unique index if not exists clients_org_email_unique on public.clients(organization_id,lower(email)) where email is not null;

alter table public.projects
  add column if not exists client_id uuid references public.clients(id) on delete set null;
create index if not exists projects_org_status_idx on public.projects(organization_id,status,updated_at desc);

create table if not exists public.financial_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  project_id uuid references public.projects(id) on delete set null,
  direction text not null check (direction in ('income','expense')),
  category text not null,
  description text not null,
  amount_ngn bigint not null check (amount_ngn > 0),
  status text not null default 'recorded' check (status in ('recorded','pending','void')),
  occurred_at date not null default current_date,
  recorded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
create index if not exists financial_transactions_org_date_idx on public.financial_transactions(organization_id,occurred_at desc);

create table if not exists public.approval_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null check (category in ('outreach','pricing','contract','payment','delivery','other')),
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  requested_by uuid references auth.users(id),
  decided_by uuid references auth.users(id),
  decision_note text,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists approval_requests_org_status_idx on public.approval_requests(organization_id,status,created_at desc);

alter table public.clients enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.approval_requests enable row level security;

create policy "members manage clients" on public.clients for all
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage financial transactions" on public.financial_transactions for all
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage approval requests" on public.approval_requests for all
  using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
