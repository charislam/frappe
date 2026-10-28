CREATE OR REPLACE FUNCTION public.budgie_create_budget (
  p_budget  uuid,
  p_request uuid,
  p_data    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := auth.uid(); saved public.write_requests; ready uuid; result jsonb;
  hash text := encode(sha256(convert_to('create_budget:' || p_data::text,'UTF8')),'hex');
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_budget is null or p_request is null then raise exception 'Budget and request IDs required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_budget::text,0));
  if exists (select 1 from public.budgets where id = p_budget) then
    perform budgie_private.lock_budget(p_budget);
    select * into saved from public.write_requests where budget_id = p_budget and request_id = p_request;
    if not found or saved.actor_user_id <> actor or saved.payload_hash <> hash then raise exception 'Budget or request already exists'; end if;
    return saved.result;
  end if;
  insert into public.budgets (id,name,currency_code,minor_unit_scale) values (p_budget,p_data->>'name',p_data->>'currency_code',(p_data->>'minor_unit_scale')::smallint);
  insert into public.budget_owners (budget_id,user_id) values (p_budget,actor);
  insert into public.envelopes (budget_id,name,kind,sort_order) values (p_budget,'Ready to assign','ready_to_assign',0) returning id into ready;
  result := jsonb_build_object('id',p_budget,'ready_to_assign_id',ready);
  insert into public.write_requests (budget_id,request_id,actor_user_id,payload_hash,result) values (p_budget,p_request,actor,hash,result);
  insert into public.audit_events (budget_id,actor_user_id,operation,entity_type,entity_id,after_data,request_id)
    values (p_budget,actor,'budget_create','budget',p_budget,p_data || result,p_request),
      (p_budget,actor,'owner_add','owner',actor,jsonb_build_object('user_id',actor),p_request);
  perform budgie_private.replay(p_budget,budgie_private.local_date(p_data->>'time_zone'));
  return result;
end $function$;

GRANT EXECUTE ON FUNCTION "public"."budgie_create_budget"(uuid, uuid, jsonb) TO "authenticated";

GRANT EXECUTE ON FUNCTION "public"."budgie_create_budget"(uuid, uuid, jsonb) TO "service_role";

REVOKE ALL ON FUNCTION "public"."budgie_create_budget"(uuid, uuid, jsonb) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."budgie_create_budget"(uuid, uuid, jsonb) TO "postgres";

REVOKE ALL ON FUNCTION "public"."budgie_create_budget"(uuid, uuid, jsonb) FROM PUBLIC, "anon";
