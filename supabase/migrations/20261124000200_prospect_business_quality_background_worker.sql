create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

alter table public.prospect_discovery_state
  add column if not exists lease_until timestamptz;

create or replace function public.claim_prospect_discovery_lock(
  p_organization_id uuid,
  p_lease_seconds integer default 240
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claimed integer;
begin
  update public.prospect_discovery_state
     set lease_until = now() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 240), 600))),
         updated_at = now()
   where organization_id = p_organization_id
     and (lease_until is null or lease_until < now());
  get diagnostics v_claimed = row_count;
  return v_claimed = 1;
end;
$$;

revoke all on function public.claim_prospect_discovery_lock(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_prospect_discovery_lock(uuid, integer) to service_role;