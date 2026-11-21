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
