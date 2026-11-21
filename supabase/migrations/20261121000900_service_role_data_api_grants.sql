-- Ensure all Business Command Centre server routes can reach existing public-schema
-- objects through Supabase Data API when automatic table exposure is disabled.
-- No anon privileges are granted. Keep the service-role key server-side only.

grant usage on schema public to service_role;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select, update on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Preserve server access for future migrations created by the postgres migration role.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to service_role;
alter default privileges for role postgres in schema public
  grant usage, select, update on sequences to service_role;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
-- Remove PostgreSQL's global PUBLIC EXECUTE default for future functions;
-- the schema-specific service_role grant above remains in force.
alter default privileges for role postgres
  revoke execute on functions from public;

-- The existing platform helper is an event-trigger function, not an application RPC.
-- Keep it unavailable to browser roles; PostgreSQL event triggers still invoke it as configured.
revoke all on function public.rls_auto_enable() from public;
revoke all on function public.rls_auto_enable() from anon;
revoke all on function public.rls_auto_enable() from authenticated;
