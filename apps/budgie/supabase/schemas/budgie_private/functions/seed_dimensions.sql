CREATE OR REPLACE FUNCTION budgie_private.seed_dimensions(p_budget uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
begin
  insert into public.account_balances (budget_id,account_id,balance_minor)
    select p_budget,id,0 from public.accounts where budget_id = p_budget on conflict do nothing;
  -- Newly created envelopes have no history and start at zero in existing months.
  insert into public.envelope_month_balances (budget_id,envelope_id,month,opening_minor,allocated_minor,activity_minor,closing_minor)
    select p_budget,e.id,m.month,0,0,0,0 from public.envelopes e
      cross join (select distinct month from public.envelope_month_balances where budget_id = p_budget) m
    where e.budget_id = p_budget and not exists (
      select 1 from public.envelope_month_balances b where b.budget_id = p_budget and b.envelope_id = e.id and b.month = m.month);
  update public.replay_checkpoints c set account_balances = (
    select budgie_private.lossless_json(jsonb_agg(jsonb_build_object('account_id',a.id,'balance_minor',coalesce(s.balance_minor,0)) order by a.id))
    from public.accounts a left join jsonb_to_recordset(c.account_balances) s(account_id uuid,balance_minor bigint) on s.account_id = a.id
    where a.budget_id = p_budget)
    where c.budget_id = p_budget and exists (select 1 from public.accounts a where a.budget_id = p_budget
      and not exists (select 1 from jsonb_to_recordset(c.account_balances) s(account_id uuid) where s.account_id = a.id));
end $function$;
REVOKE ALL ON FUNCTION budgie_private.seed_dimensions(uuid) FROM PUBLIC;
