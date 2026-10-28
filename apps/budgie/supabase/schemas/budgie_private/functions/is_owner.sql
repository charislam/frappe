CREATE OR REPLACE FUNCTION budgie_private.is_owner (
  p_budget uuid
)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
  select exists (select 1 from public.budget_owners where budget_id = p_budget and user_id = (select auth.uid()));
$function$;

GRANT EXECUTE ON FUNCTION "budgie_private"."is_owner"(uuid) TO "authenticated";

REVOKE ALL ON FUNCTION "budgie_private"."is_owner"(uuid) FROM PUBLIC;
