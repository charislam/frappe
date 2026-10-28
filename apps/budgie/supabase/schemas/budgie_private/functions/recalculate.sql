-- Rebuild a suffix from the last unaffected month, or start from zero.
CREATE OR REPLACE FUNCTION budgie_private.recalculate(p_budget uuid,p_options jsonb) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare
  through_date date := coalesce((p_options->>'through')::date,current_date);
  requested_start date := (p_options->>'from_month')::date;
  point public.replay_checkpoints; resume boolean := false;
  month_start date; last_month date; cached_through date; cached_first date; event record;
begin
  select min(month),max(month) into cached_first,cached_through from public.envelope_month_balances where budget_id = p_budget;
  if requested_start is not null then
    select * into point from public.replay_checkpoints where budget_id = p_budget and month < date_trunc('month',requested_start)::date order by month desc limit 1;
    resume := found;
  end if;
  select least(date_trunc('month',through_date)::date,cached_first,
    coalesce((select min(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted'),through_date),
    coalesce((select min(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),through_date)) into month_start;
  month_start := date_trunc('month',month_start)::date;
  select greatest(cached_through,date_trunc('month',through_date)::date,
    (select max(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),
    (select max(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted')) into last_month;
  -- The caller holds the budget lock; all intermediate state remains uncommitted.
  delete from public.deficit_lots where budget_id = p_budget;
  delete from public.account_balances where budget_id = p_budget;
  insert into public.account_balances (budget_id,account_id,balance_minor) select p_budget,id,0 from public.accounts where budget_id = p_budget;
  if resume then
    month_start := (point.month+interval '1 month')::date;
    update public.account_balances b set balance_minor = s.balance_minor
      from jsonb_to_recordset(point.account_balances) s(account_id uuid,balance_minor bigint)
      where b.budget_id = p_budget and b.account_id = s.account_id;
    insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,card_id,remaining_minor,eligible_minor,direct_covered_minor)
      select p_budget,s.ordinal,s.transaction_id,s.position,s.envelope_id,s.card_id,s.remaining_minor,s.eligible_minor,s.direct_covered_minor
      from jsonb_to_recordset(point.deficit_lots) s(ordinal bigint,transaction_id uuid,position integer,envelope_id uuid,card_id uuid,remaining_minor bigint,eligible_minor bigint,direct_covered_minor bigint);
    delete from public.envelope_month_balances where budget_id = p_budget and month >= month_start;
    delete from public.replay_checkpoints where budget_id = p_budget and month >= month_start;
  else
    delete from public.envelope_month_balances where budget_id = p_budget;
    delete from public.replay_checkpoints where budget_id = p_budget;
  end if;
  while month_start <= last_month loop
    insert into public.envelope_month_balances (budget_id,envelope_id,month,opening_minor,allocated_minor,activity_minor,closing_minor)
      select p_budget,e.id,month_start,coalesce(previous.closing_minor,0),0,0,coalesce(previous.closing_minor,0)
      from public.envelopes e left join public.envelope_month_balances previous
        on previous.budget_id = e.budget_id and previous.envelope_id = e.id and previous.month = (month_start-interval '1 month')::date
      where e.budget_id = p_budget;
    for event in
      select id,month as day,sequence,0 as priority from public.allocation_batches
        where budget_id = p_budget and voided_at is null and month = month_start
      union all
      select id,effective_date,sequence,1 from public.transactions
        where budget_id = p_budget and status = 'posted' and effective_date >= month_start and effective_date < (month_start+interval '1 month')::date
      order by day,priority,sequence
    loop
      case event.priority
        when 0 then perform budgie_private.apply_allocation(event.id);
        when 1 then perform budgie_private.apply_transaction(event.id);
      end case;
    end loop;
    perform budgie_private.save_checkpoint(p_budget,month_start);
    month_start := (month_start+interval '1 month')::date;
  end loop;
end $function$;
REVOKE ALL ON FUNCTION budgie_private.recalculate(uuid,jsonb) FROM PUBLIC;
