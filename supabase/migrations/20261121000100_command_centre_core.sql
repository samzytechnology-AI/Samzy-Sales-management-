-- Samzy Business Command Centre only. Never apply this migration to School Cloud.
create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','manager','staff','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create or replace function public.is_org_member(target_org uuid)
returns boolean language sql stable security definer set search_path = public
as $$ select exists (select 1 from public.organization_members m where m.organization_id = target_org and m.user_id = auth.uid()) $$;

create table if not exists public.company_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category text not null check (category in ('policy','decision','client_context','project_context','lesson','preference','temporary_instruction')),
  title text not null,
  content text not null,
  source_type text not null default 'user_instruction',
  source_reference text,
  confidence numeric(4,3) not null default 1.000 check (confidence between 0 and 1),
  is_approved boolean not null default false,
  expires_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists company_memory_org_category_idx on public.company_memory(organization_id, category, created_at desc);

create table if not exists public.pricing_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  service_key text not null,
  minimum_price_ngn bigint not null check (minimum_price_ngn >= 0),
  default_negotiation_margin_ngn bigint not null default 100000 check (default_negotiation_margin_ngn >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (organization_id, service_key)
);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  company_name text not null,
  website_url text,
  industry text,
  country text,
  fit_score integer check (fit_score between 0 and 100),
  status text not null default 'discovered' check (status in ('discovered','researching','qualified','contacted','replied','opportunity','customer','disqualified')),
  research_summary text,
  evidence jsonb not null default '[]'::jsonb,
  discovered_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists prospects_org_website_unique on public.prospects(organization_id, lower(website_url)) where website_url is not null;
create index if not exists prospects_org_status_idx on public.prospects(organization_id, status, created_at desc);

create table if not exists public.contact_points (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp','voice','other')),
  address text not null,
  is_verified boolean not null default false,
  consent_basis text,
  created_at timestamptz not null default now(),
);
create unique index if not exists contact_points_org_channel_address_unique on public.contact_points(organization_id, channel, lower(address));

create table if not exists public.suppression_list (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  channel text not null,
  normalized_address text not null,
  reason text not null default 'opt_out',
  created_at timestamptz not null default now(),
  unique (organization_id, channel, normalized_address)
);

create table if not exists public.outreach_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  channel text not null check (channel in ('email','whatsapp','voice')),
  recipient text not null,
  direction text not null check (direction in ('outbound','inbound')),
  status text not null default 'draft',
  body text,
  provider_message_id text,
  approved_by uuid references auth.users(id),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists outreach_events_contact_time_idx on public.outreach_events(organization_id, lower(recipient), created_at desc);

create table if not exists public.product_registry (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  product_name text not null,
  product_key text not null,
  dashboard_url text,
  integration_mode text not null default 'manual' check (integration_mode in ('manual','api','webhook','oauth')),
  health_status text not null default 'unknown' check (health_status in ('unknown','healthy','degraded','offline')),
  capabilities jsonb not null default '[]'::jsonb,
  secret_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, product_key)
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  product_id uuid references public.product_registry(id) on delete set null,
  project_name text not null,
  status text not null default 'planned' check (status in ('planned','in_progress','blocked','review','delivered','cancelled')),
  quoted_amount_ngn bigint check (quoted_amount_ngn >= 0),
  approved_amount_ngn bigint check (approved_amount_ngn >= 0),
  due_at timestamptz,
  delivery_urls jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  objective text not null,
  task_type text not null,
  model_contributions jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  status text not null default 'completed',
  total_input_tokens bigint not null default 0,
  total_output_tokens bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  actor_type text not null default 'user',
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.company_memory enable row level security;
alter table public.pricing_policies enable row level security;
alter table public.prospects enable row level security;
alter table public.contact_points enable row level security;
alter table public.suppression_list enable row level security;
alter table public.outreach_events enable row level security;
alter table public.product_registry enable row level security;
alter table public.projects enable row level security;
alter table public.ai_runs enable row level security;
alter table public.audit_events enable row level security;

create policy "members read organizations" on public.organizations for select using (public.is_org_member(id));
create policy "members read membership" on public.organization_members for select using (public.is_org_member(organization_id));
create policy "members manage memory" on public.company_memory for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage pricing" on public.pricing_policies for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage prospects" on public.prospects for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage contacts" on public.contact_points for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage suppression" on public.suppression_list for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage outreach" on public.outreach_events for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage products" on public.product_registry for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members manage projects" on public.projects for all using (public.is_org_member(organization_id)) with check (public.is_org_member(organization_id));
create policy "members read ai runs" on public.ai_runs for select using (public.is_org_member(organization_id));
create policy "members read audit" on public.audit_events for select using (public.is_org_member(organization_id));
