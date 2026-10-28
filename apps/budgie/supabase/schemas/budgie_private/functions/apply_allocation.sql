CREATE OR REPLACE FUNCTION budgie_private.apply_allocation(p_batch uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare batch public.allocation_batches; p_budget uuid; month_start date; line record; old_balance bigint; amount bigint;
begin
  select * into strict batch from public.allocation_batches where id = p_batch;
  p_budget := batch.budget_id;
  month_start := batch.month;
for line in select x.*,e.credit_account_id from public.allocation_entries x join public.envelopes e on e.id = x.envelope_id
  where batch_id = batch.id order by e.kind,x.envelope_id loop
  select closing_minor into strict old_balance from public.envelope_month_balances
    where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
  update public.envelope_month_balances set closing_minor = closing_minor+line.amount_minor,allocated_minor = allocated_minor+line.amount_minor
    where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
  if line.credit_account_id is not null then
    amount := greatest(old_balance+line.amount_minor,0)-greatest(old_balance,0);
    perform budgie_private.direct_coverage(line.credit_account_id,amount);
  end if;
end loop;
for line in select * from public.allocation_entries where batch_id = batch.id and amount_minor > 0 order by envelope_id loop
  select closing_minor-line.amount_minor into strict old_balance from public.envelope_month_balances
    where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
  perform budgie_private.cover_deficit(line.envelope_id,month_start,least(line.amount_minor,greatest(-old_balance,0)));
end loop;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.apply_allocation(uuid) FROM PUBLIC;
