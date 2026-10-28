-- Derive the viewer's calendar day from a server instant, never a supplied date.
-- The optional instant is private and supports deterministic timezone/DST tests.
CREATE OR REPLACE FUNCTION budgie_private.local_date(p_time_zone text,p_instant timestamptz DEFAULT CURRENT_TIMESTAMP) RETURNS date
LANGUAGE plpgsql STABLE SET search_path TO '' AS $function$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Valid viewer time zone required';
  end if;
  return (p_instant at time zone p_time_zone)::date;
end $function$;
REVOKE ALL ON FUNCTION budgie_private.local_date(text,timestamptz) FROM PUBLIC;
