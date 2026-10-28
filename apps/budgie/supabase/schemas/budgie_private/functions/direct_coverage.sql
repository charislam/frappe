CREATE OR REPLACE FUNCTION budgie_private.direct_coverage (
  p_card uuid,
  p_amount bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare lot record; used bigint; left_over bigint := abs(p_amount); p_budget uuid;
begin
  select budget_id into strict p_budget from public.accounts where id = p_card;
  for lot in select * from public.deficit_lots where budget_id = p_budget and card_id = p_card and remaining_minor > 0
    order by case when p_amount > 0 then ordinal else -ordinal end loop
    exit when left_over = 0;
    if p_amount > 0 then
      used := least(left_over,lot.eligible_minor);
      update public.deficit_lots set eligible_minor = eligible_minor-used,direct_covered_minor = direct_covered_minor+used
        where budget_id = p_budget and ordinal = lot.ordinal;
    else
      used := least(left_over,lot.direct_covered_minor);
      update public.deficit_lots set eligible_minor = eligible_minor+used,direct_covered_minor = direct_covered_minor-used
        where budget_id = p_budget and ordinal = lot.ordinal;
    end if;
    left_over := left_over-used;
  end loop;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.direct_coverage(uuid, bigint) FROM PUBLIC;
