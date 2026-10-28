-- Full rebuild remains the reference path.
CREATE OR REPLACE FUNCTION budgie_private.replay(p_budget uuid,p_through date) RETURNS void
LANGUAGE sql SET search_path TO '' AS $function$
  select budgie_private.recalculate(p_budget,jsonb_build_object('through',p_through));
$function$;
REVOKE ALL ON FUNCTION budgie_private.replay(uuid,date) FROM PUBLIC;
