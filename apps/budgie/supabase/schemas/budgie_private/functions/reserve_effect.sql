CREATE OR REPLACE FUNCTION budgie_private.reserve_effect (
  p_card uuid,
  p_month date,
  p_amount bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare payment_envelope uuid; p_budget uuid;
begin
  if p_amount = 0 then return; end if;
  select id,budget_id into strict payment_envelope,p_budget from public.envelopes where credit_account_id = p_card;
  update public.envelope_month_balances set closing_minor = closing_minor+p_amount,activity_minor = activity_minor+p_amount
    where budget_id = p_budget and envelope_id = payment_envelope and month = p_month;
  if not found then raise exception 'Payment envelope month is not materialized'; end if;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.reserve_effect(uuid, date, bigint) FROM PUBLIC;
