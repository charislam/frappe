CREATE OR REPLACE FUNCTION budgie_private.protect_identity()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
begin
  if tg_table_name = 'budgets' then
    if (new.currency_code,new.minor_unit_scale) is distinct from (old.currency_code,old.minor_unit_scale)
      and (exists (select 1 from public.transactions where budget_id = old.id)
        or exists (select 1 from public.allocation_batches where budget_id = old.id)) then raise exception 'Currency is immutable after financial history'; end if;
  elsif tg_table_name = 'accounts' then
    if new.kind <> old.kind and exists (select 1 from public.account_entries where account_id = old.id) then raise exception 'Account kind is immutable after activity'; end if;
  elsif tg_table_name = 'envelopes' then
    if (new.kind,new.credit_account_id) is distinct from (old.kind,old.credit_account_id) or (old.kind <> 'regular' and new.archived_at is not null) then
      raise exception 'System envelope identity is immutable'; end if;
  else
    if new.sequence <> old.sequence or new.created_at <> old.created_at or new.created_by <> old.created_by or new.budget_id <> old.budget_id then
      raise exception 'Aggregate creation identity is immutable'; end if;
    if new.version <> old.version + 1 then raise exception 'Aggregate version must advance once'; end if;
  end if;
  return new;
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."protect_identity"() FROM PUBLIC;
