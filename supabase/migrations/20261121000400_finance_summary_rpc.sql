-- Exact all-time finance aggregates for the company dashboard.
create or replace function public.get_financial_summary(p_organization_id uuid)
returns table(income_ngn numeric, expenses_ngn numeric, net_ngn numeric, transaction_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(sum(amount_ngn) filter (where direction = 'income' and status <> 'void'), 0) as income_ngn,
    coalesce(sum(amount_ngn) filter (where direction = 'expense' and status <> 'void'), 0) as expenses_ngn,
    coalesce(sum(case when direction = 'income' then amount_ngn when direction = 'expense' then -amount_ngn else 0 end) filter (where status <> 'void'), 0) as net_ngn,
    count(*) filter (where status <> 'void') as transaction_count
  from public.financial_transactions
  where organization_id = p_organization_id;
$$;
revoke all on function public.get_financial_summary(uuid) from public;
revoke all on function public.get_financial_summary(uuid) from anon;
revoke all on function public.get_financial_summary(uuid) from authenticated;
grant execute on function public.get_financial_summary(uuid) to service_role;
