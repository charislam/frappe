CREATE OR REPLACE FUNCTION budgie_private.aggregate (
  p_kind text,
  p_id   uuid
)
  RETURNS jsonb
  LANGUAGE sql
  STABLE
  SET search_path TO ''
  AS $function$
  select case p_kind
    when 'transaction' then (select to_jsonb(t) || jsonb_build_object(
      'entries',coalesce((select jsonb_agg(to_jsonb(e) order by position) from public.account_entries e where transaction_id = t.id),'[]'),
      'splits',coalesce((select jsonb_agg(to_jsonb(s) order by position) from public.transaction_splits s where transaction_id = t.id),'[]'))
      from public.transactions t where id = p_id)
    when 'allocation' then (select to_jsonb(a) || jsonb_build_object(
      'entries',coalesce((select jsonb_agg(to_jsonb(e) order by envelope_id) from public.allocation_entries e where batch_id = a.id),'[]'))
      from public.allocation_batches a where id = p_id)
    else null end;
$function$;

REVOKE ALL ON FUNCTION "budgie_private"."aggregate"(text, uuid) FROM PUBLIC;
