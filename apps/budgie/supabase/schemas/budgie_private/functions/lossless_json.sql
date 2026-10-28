CREATE OR REPLACE FUNCTION budgie_private.lossless_json (
  p_value jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
declare result jsonb; item record;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      result := '{}';
      for item in select * from jsonb_each(p_value) loop
        result := result || jsonb_build_object(item.key,case when item.key like '%_minor' or item.key in ('sequence','version','ordinal') then
          case when item.value = 'null'::jsonb then 'null'::jsonb else to_jsonb(item.value #>> '{}') end
          else budgie_private.lossless_json(item.value) end);
      end loop;
      return result;
    when 'array' then
      select coalesce(jsonb_agg(budgie_private.lossless_json(value)),'[]') into result from jsonb_array_elements(p_value);
      return result;
    else return p_value;
  end case;
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."lossless_json"(jsonb) FROM PUBLIC;
