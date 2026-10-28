-- The caller holds the budget lock. Extend only empty ranges; never replay inputs.
CREATE OR REPLACE FUNCTION budgie_private.ensure_months(p_budget uuid,p_through date) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare first_month date; last_month date; wanted date := date_trunc('month',p_through)::date;
begin
  select min(month),max(month) into first_month,last_month from public.envelope_month_balances where budget_id = p_budget;
  if wanted between first_month and last_month then return; end if;
  insert into public.envelope_month_balances (budget_id,envelope_id,month,opening_minor,allocated_minor,activity_minor,closing_minor)
    select p_budget,e.id,m.month,coalesce(previous.closing_minor,0),0,0,coalesce(previous.closing_minor,0)
    from public.envelopes e cross join (
      select generate_series(wanted,coalesce(first_month,wanted)-interval '1 month',interval '1 month')::date as month
      union select generate_series(coalesce(last_month,wanted)+interval '1 month',wanted,interval '1 month')::date
      union select wanted
    ) m
    left join lateral (select b.closing_minor from public.envelope_month_balances b
      where b.budget_id = p_budget and b.envelope_id = e.id and b.month < m.month order by b.month desc limit 1) previous on true
    where e.budget_id = p_budget
      and not exists (select 1 from public.envelope_month_balances b where b.budget_id = p_budget and b.envelope_id = e.id and b.month = m.month);
  -- Earlier empty months precede every input; later empty months carry current state.
  insert into public.replay_checkpoints (budget_id,month,account_balances,deficit_lots,last_ordinal)
    select p_budget,m.month,
      budgie_private.lossless_json((select coalesce(jsonb_agg(jsonb_build_object('account_id',a.account_id,'balance_minor',
        case when m.month < first_month then 0 else a.balance_minor end) order by a.account_id),'[]')
        from public.account_balances a where a.budget_id = p_budget)),
      case when m.month < first_month then '[]'::jsonb else
        budgie_private.lossless_json((select coalesce(jsonb_agg(to_jsonb(l) order by ordinal),'[]') from public.deficit_lots l where l.budget_id = p_budget and remaining_minor > 0)) end,
      case when m.month < first_month then 0 else coalesce((select last_ordinal from public.replay_checkpoints where budget_id = p_budget order by month desc limit 1),0) end
    from (select distinct month from public.envelope_month_balances where budget_id = p_budget) m
    where (first_month is null or m.month < first_month or m.month > last_month)
    on conflict do nothing;
end $function$;
REVOKE ALL ON FUNCTION budgie_private.ensure_months(uuid,date) FROM PUBLIC;
