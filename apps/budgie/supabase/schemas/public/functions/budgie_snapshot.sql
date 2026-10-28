CREATE OR REPLACE FUNCTION public.budgie_snapshot (
  p_budget uuid,
  p_month  date,
  p_time_zone text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb; today date; period_balances jsonb;
begin
  perform budgie_private.lock_budget(p_budget);
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'First day of month required'; end if;
  today := budgie_private.local_date(p_time_zone);
  perform budgie_private.ensure_months(p_budget,greatest(p_month,today));
  perform budgie_private.ensure_months(p_budget,p_month);
  -- All protected writes maintain canonical month-end checkpoints under this lock.
  -- ensure_months also creates them when a read extends the cached empty range.
  select c.account_balances into strict period_balances from public.replay_checkpoints c
    where c.budget_id = p_budget and c.month = p_month;
  with period_accounts as (
    select a.id,a.budget_id,a.kind,b.balance_minor
    from jsonb_to_recordset(period_balances) b(account_id uuid,balance_minor bigint)
      join public.accounts a on a.id = b.account_id and a.budget_id = p_budget
  )
  select jsonb_build_object(
    'overview',jsonb_build_object(
      'cash_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'cash'),
      'investment_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'investment'),
      'credit_debt_minor',(select coalesce(sum(greatest(-balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'credit'),
      'positive_credit_minor',(select coalesce(sum(greatest(balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'credit'),
      'negative_payment_reserve_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = p_budget and b.month = p_month and e.kind = 'credit_payment'),
      'negative_spending_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = p_budget and b.month = p_month and e.kind = 'regular'),
      'uncovered_debt_minor',(select coalesce(sum(greatest(-a.balance_minor-greatest(e.closing_minor,0),0)),0) from period_accounts a
        join public.envelopes p on p.credit_account_id = a.id join public.envelope_month_balances e on e.envelope_id = p.id and e.month = p_month where a.budget_id = p_budget)
    ),
    'budget',(select to_jsonb(b) from public.budgets b where id = p_budget),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('balance_minor',b.balance_minor) order by sort_order),'[]') from public.accounts a join public.account_balances b on b.account_id = a.id where a.budget_id = p_budget),
    'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by sort_order),'[]') from public.envelope_groups g where budget_id = p_budget),
    'envelopes',(select coalesce(jsonb_agg(to_jsonb(e) || to_jsonb(b) order by e.sort_order),'[]') from public.envelopes e join public.envelope_month_balances b on b.envelope_id = e.id where e.budget_id = p_budget and b.month = p_month),
    'ready_to_assign_minor',budgie_private.ready_available(p_budget,p_month),
    'transactions',(select coalesce(jsonb_agg(budgie_private.aggregate('transaction',t.id) order by effective_date,sequence),'[]') from public.transactions t where budget_id = p_budget),
    'allocations',(select coalesce(jsonb_agg(budgie_private.aggregate('allocation',a.id) order by month,sequence),'[]') from public.allocation_batches a where budget_id = p_budget),
    'payees',(select coalesce(jsonb_agg(to_jsonb(p) order by name),'[]') from public.payees p where budget_id = p_budget),
    'deficits',(select coalesce(jsonb_agg(to_jsonb(l) order by ordinal),'[]') from public.deficit_lots l where budget_id = p_budget and remaining_minor > 0)
  ) into result;
  return budgie_private.lossless_json(result);
end $function$;

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "service_role";

REVOKE ALL ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "postgres";

REVOKE ALL ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) FROM PUBLIC, "anon";
