CREATE OR REPLACE FUNCTION budgie_private.lock_budget (
  p_budget uuid
)
  RETURNS uuid
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform 1 from public.budgets where id = p_budget for update;
  if not found or not budgie_private.is_owner(p_budget) then raise exception 'Budget access denied' using errcode = '42501'; end if;
  return actor;
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."lock_budget"(uuid) FROM PUBLIC;
