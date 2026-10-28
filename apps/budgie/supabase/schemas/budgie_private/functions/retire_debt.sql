CREATE OR REPLACE FUNCTION budgie_private.retire_debt (
  p_card uuid,
  p_amount bigint,
  p_reserved bigint DEFAULT 0
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare lot record; used bigint; direct_total bigint; left_over bigint; p_budget uuid;
begin
  select budget_id into strict p_budget from public.accounts where id = p_card;
  select coalesce(sum(direct_covered_minor),0) into direct_total from public.deficit_lots where budget_id = p_budget and card_id = p_card;
  left_over := greatest(p_amount-greatest(p_reserved-direct_total,0),0);
  for lot in select * from public.deficit_lots where budget_id = p_budget and card_id = p_card and direct_covered_minor > 0 order by ordinal loop
    exit when left_over = 0;
    used := least(left_over,lot.direct_covered_minor);
    update public.deficit_lots set direct_covered_minor = direct_covered_minor-used where budget_id = p_budget and ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
  for lot in select * from public.deficit_lots where budget_id = p_budget and card_id = p_card and eligible_minor > 0 order by ordinal loop
    exit when left_over = 0;
    used := least(left_over,lot.eligible_minor);
    update public.deficit_lots set eligible_minor = eligible_minor-used where budget_id = p_budget and ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.retire_debt(uuid, bigint, bigint) FROM PUBLIC;
