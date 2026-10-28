-- Ignore labels, versions, and regenerated child UUIDs when detecting corrections.
CREATE OR REPLACE FUNCTION budgie_private.financial_shape(p_aggregate jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE STRICT SET search_path TO '' AS $function$
  select jsonb_build_object('kind',p_aggregate->'kind','status',p_aggregate->'status','effective_date',p_aggregate->'effective_date',
    'entries',(select jsonb_agg(jsonb_build_object('account_id',e->'account_id','amount_minor',e->'amount_minor','position',e->'position') order by (e->>'position')::integer) from jsonb_array_elements(p_aggregate->'entries') e),
    'splits',(select jsonb_agg(jsonb_build_object('envelope_id',e->'envelope_id','amount_minor',e->'amount_minor','position',e->'position') order by (e->>'position')::integer) from jsonb_array_elements(p_aggregate->'splits') e));
$function$;
REVOKE ALL ON FUNCTION budgie_private.financial_shape(jsonb) FROM PUBLIC;
