CREATE OR REPLACE FUNCTION budgie_private.check_aggregate()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare payload jsonb := coalesce(to_jsonb(new),to_jsonb(old));
begin
  if tg_table_name in ('transactions','account_entries','transaction_splits') then
    perform budgie_private.validate_transaction(case when tg_table_name = 'transactions' then (payload->>'id')::uuid else (payload->>'transaction_id')::uuid end);
  else
    perform budgie_private.validate_budget(case when tg_table_name = 'budgets' then (payload->>'id')::uuid else (payload->>'budget_id')::uuid end);
  end if;
  return null;
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."check_aggregate"() FROM PUBLIC;
