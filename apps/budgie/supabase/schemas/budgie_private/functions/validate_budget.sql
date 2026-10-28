CREATE OR REPLACE FUNCTION budgie_private.validate_budget (
  p_budget uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if not exists (select 1 from public.budgets where id = p_budget) then return; end if;
  if not exists (select 1 from public.budget_owners where budget_id = p_budget) then raise exception 'A budget must retain an owner'; end if;
  if (select count(*) from public.envelopes where budget_id = p_budget and kind = 'ready_to_assign') <> 1 then
    raise exception 'A budget must have one Ready to assign envelope'; end if;
  if exists (select 1 from public.accounts a left join public.envelopes e on e.budget_id = a.budget_id and e.credit_account_id = a.id
      where a.budget_id = p_budget and ((a.kind = 'credit' and e.id is null) or (a.kind <> 'credit' and e.id is not null))) then
    raise exception 'Credit accounts require exactly one payment envelope'; end if;
  if exists (select 1 from public.allocation_batches b left join public.allocation_entries e on e.batch_id = b.id
    where b.budget_id = p_budget group by b.id having count(e.id) < 2 or sum(e.amount_minor) <> 0) then
    raise exception 'Allocation batches require balanced entries'; end if;
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."validate_budget"(uuid) FROM PUBLIC;
