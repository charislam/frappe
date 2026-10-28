CREATE OR REPLACE FUNCTION public.budgie_reconciliation_preview (
  p_budget  uuid,
  p_account uuid,
  p_date    date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare recorded bigint;
begin
  perform budgie_private.lock_budget(p_budget);
  if p_date is null or not exists (select 1 from public.accounts where budget_id = p_budget and id = p_account and archived_at is null) then
    raise exception 'Active budget account and selected financial date required'; end if;
  select coalesce(sum(e.amount_minor),0) into recorded from public.account_entries e join public.transactions t on t.id = e.transaction_id
    where e.budget_id = p_budget and e.account_id = p_account and t.status = 'posted' and t.effective_date <= p_date;
  return jsonb_build_object('account_id',p_account,'effective_date',p_date,'recorded_minor',recorded::text);
end $function$;

GRANT EXECUTE ON FUNCTION "public"."budgie_reconciliation_preview"(uuid, uuid, date) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."budgie_reconciliation_preview"(uuid, uuid, date) TO "service_role";

REVOKE ALL ON FUNCTION "public"."budgie_reconciliation_preview"(uuid, uuid, date) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."budgie_reconciliation_preview"(uuid, uuid, date) TO "postgres";

REVOKE ALL ON FUNCTION "public"."budgie_reconciliation_preview"(uuid, uuid, date) FROM PUBLIC, "anon";
