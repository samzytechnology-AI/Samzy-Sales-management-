-- Dedicated Gmail OAuth connection for the Samzy Business Command Centre.
-- Tokens are encrypted by the application and readable only by the server service role.
create table if not exists public.gmail_integrations (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  email_address text not null,
  refresh_token_ciphertext text not null,
  scopes text[] not null default '{}',
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.gmail_integrations enable row level security;
revoke all on table public.gmail_integrations from anon, authenticated;
grant select, insert, update, delete on table public.gmail_integrations to service_role;
