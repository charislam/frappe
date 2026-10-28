CREATE OR REPLACE FUNCTION budgie_private.save_checkpoint(p_budget uuid,p_month date) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare high_water bigint;
begin
  select greatest(
    coalesce((select ordinal from public.deficit_lots where budget_id = p_budget order by ordinal desc limit 1),0),
    coalesce((select last_ordinal from public.replay_checkpoints where budget_id = p_budget order by month desc limit 1),0)
  ) into high_water;
  insert into public.replay_checkpoints (budget_id,month,account_balances,deficit_lots,last_ordinal)
    values (p_budget,p_month,
      budgie_private.lossless_json((select coalesce(jsonb_agg(jsonb_build_object('account_id',account_id,'balance_minor',balance_minor) order by account_id),'[]') from public.account_balances where budget_id = p_budget)),
      budgie_private.lossless_json((select coalesce(jsonb_agg(to_jsonb(l) order by ordinal),'[]') from public.deficit_lots l where budget_id = p_budget and remaining_minor > 0)),
      high_water)
    on conflict (budget_id,month) do update set account_balances = excluded.account_balances,deficit_lots = excluded.deficit_lots,last_ordinal = excluded.last_ordinal;
  delete from public.deficit_lots where budget_id = p_budget and remaining_minor = 0;
end $function$;
REVOKE ALL ON FUNCTION budgie_private.save_checkpoint(uuid,date) FROM PUBLIC;
