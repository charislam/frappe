CREATE OR REPLACE FUNCTION budgie_private.ready_available (
  p_budget uuid,
  p_month  date
)
  RETURNS bigint
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select coalesce((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id
    where b.budget_id = p_budget and e.kind = 'ready_to_assign' and b.month = date_trunc('month',p_month)::date),0)
    + coalesce((select sum(x.amount_minor) from public.allocation_entries x
      join public.allocation_batches a on a.id = x.batch_id join public.envelopes e on e.id = x.envelope_id
      where a.budget_id = p_budget and a.voided_at is null and e.kind = 'ready_to_assign' and a.month > date_trunc('month',p_month)::date),0);
$function$;

REVOKE ALL ON FUNCTION "budgie_private"."ready_available"(uuid, date) FROM PUBLIC;
