CREATE OR REPLACE FUNCTION budgie_private.cover_deficit (
  p_envelope uuid,
  p_month date,
  p_amount bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare lot record; used bigint; reserved bigint; debt bigint; generated bigint; left_over bigint := p_amount; p_budget uuid;
begin
  select budget_id into strict p_budget from public.envelopes where id = p_envelope;
  for lot in select * from public.deficit_lots where budget_id = p_budget and envelope_id = p_envelope and remaining_minor > 0 order by ordinal loop
    exit when left_over <= 0;
    used := least(left_over,lot.remaining_minor);
    generated := 0;
    if lot.card_id is not null and lot.eligible_minor > 0 then
      select greatest(-balance_minor,0) into strict debt from public.account_balances where budget_id = p_budget and account_id = lot.card_id;
      select greatest(b.closing_minor,0) into strict reserved from public.envelope_month_balances b
        join public.envelopes e on e.budget_id = b.budget_id and e.id = b.envelope_id
        where b.budget_id = p_budget and e.credit_account_id = lot.card_id and b.month = p_month;
      generated := least(greatest(used-(lot.remaining_minor-lot.eligible_minor),0),greatest(debt-reserved,0));
      perform budgie_private.reserve_effect(lot.card_id,p_month,generated);
    end if;
    update public.deficit_lots set remaining_minor = remaining_minor-used,
      eligible_minor = eligible_minor-greatest(used-(lot.remaining_minor-lot.eligible_minor),0),
      direct_covered_minor = direct_covered_minor-least(direct_covered_minor,greatest(used-(lot.remaining_minor-lot.eligible_minor-lot.direct_covered_minor),0))
      where budget_id = p_budget and ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.cover_deficit(uuid, date, bigint) FROM PUBLIC;
