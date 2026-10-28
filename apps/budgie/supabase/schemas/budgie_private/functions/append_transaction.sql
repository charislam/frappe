CREATE OR REPLACE FUNCTION budgie_private.append_transaction(p_transaction uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare tx public.transactions; target_month date; before_balances jsonb;
begin
  select * into strict tx from public.transactions where id = p_transaction;
  if not budgie_private.can_append(tx.id) then raise exception 'Activity does not append to the calculated timeline'; end if;
  target_month := date_trunc('month',tx.effective_date)::date;
  perform budgie_private.ensure_months(tx.budget_id,target_month);
  select jsonb_object_agg(envelope_id::text,closing_minor) into before_balances from public.envelope_month_balances where budget_id = tx.budget_id and month = target_month;
  perform budgie_private.apply_transaction(tx.id);
  -- Eligibility guarantees all later materialized months have no financial events.
  update public.envelope_month_balances later set
    opening_minor = later.opening_minor+current.closing_minor-(before_balances->>current.envelope_id::text)::bigint,
    closing_minor = later.closing_minor+current.closing_minor-(before_balances->>current.envelope_id::text)::bigint
    from public.envelope_month_balances current
    where current.budget_id = tx.budget_id and current.month = target_month
      and later.budget_id = tx.budget_id and later.envelope_id = current.envelope_id and later.month > target_month
      and current.closing_minor <> (before_balances->>current.envelope_id::text)::bigint;
  perform budgie_private.save_checkpoint(tx.budget_id,target_month);
  insert into public.replay_checkpoints (budget_id,month,account_balances,deficit_lots,last_ordinal)
    select tx.budget_id,m.month,c.account_balances,c.deficit_lots,c.last_ordinal
      from (select distinct month from public.envelope_month_balances where budget_id = tx.budget_id and month > target_month) m
      cross join public.replay_checkpoints c where c.budget_id = tx.budget_id and c.month = target_month
    on conflict (budget_id,month) do update set account_balances = excluded.account_balances,deficit_lots = excluded.deficit_lots,last_ordinal = excluded.last_ordinal;
end $function$;
REVOKE ALL ON FUNCTION budgie_private.append_transaction(uuid) FROM PUBLIC;
