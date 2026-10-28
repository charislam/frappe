CREATE OR REPLACE FUNCTION budgie_private.can_append(p_transaction uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $function$
  select t.status = 'posted'
    and not exists (select 1 from public.transactions later where later.budget_id = t.budget_id and later.status = 'posted'
      and (later.effective_date,later.sequence) > (t.effective_date,t.sequence))
    and not exists (select 1 from public.allocation_batches later where later.budget_id = t.budget_id and later.voided_at is null and later.month > t.effective_date)
    from public.transactions t where t.id = p_transaction;
$function$;
REVOKE ALL ON FUNCTION budgie_private.can_append(uuid) FROM PUBLIC;
