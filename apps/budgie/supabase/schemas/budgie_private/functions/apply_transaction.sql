CREATE OR REPLACE FUNCTION budgie_private.apply_transaction(p_transaction uuid) RETURNS void
LANGUAGE plpgsql SET search_path TO '' AS $function$
declare
  tx public.transactions; p_budget uuid; month_start date; line record; account_line record;
  old_balance bigint; amount bigint; spend bigint; funded bigint; wallet bigint; card_cash bigint;
  debt_spend bigint; reserve_before bigint; card uuid; next_ordinal bigint;
begin
  select * into strict tx from public.transactions where id = p_transaction;
  if tx.status <> 'posted' then raise exception 'Only posted activity can update balances'; end if;
  p_budget := tx.budget_id;
  month_start := date_trunc('month',tx.effective_date)::date;
  select greatest(
    coalesce((select ordinal from public.deficit_lots where budget_id = p_budget order by ordinal desc limit 1),0),
    coalesce((select last_ordinal from public.replay_checkpoints where budget_id = p_budget order by month desc limit 1),0)
  ) into next_ordinal;
card := null; card_cash := 0;
for account_line in select e.*,a.kind from public.account_entries e join public.accounts a on a.id = e.account_id
  where transaction_id = tx.id order by position loop
  select balance_minor into strict old_balance from public.account_balances where budget_id = p_budget and account_id = account_line.account_id;
  update public.account_balances set balance_minor = balance_minor+account_line.amount_minor where budget_id = p_budget and account_id = account_line.account_id;
  if account_line.kind = 'credit' then
    card := account_line.account_id;
    card_cash := greatest(old_balance,0);
    if account_line.amount_minor > 0 and (tx.kind in ('refund','transfer') or (tx.kind = 'adjustment' and exists (select 1 from public.transaction_splits where transaction_id = tx.id))) then
      select b.closing_minor into strict reserve_before from public.envelope_month_balances b
        join public.envelopes e on e.budget_id = b.budget_id and e.id = b.envelope_id
        where b.budget_id = p_budget and e.credit_account_id = card and b.month = month_start;
      perform budgie_private.retire_debt(card,least(account_line.amount_minor,greatest(-old_balance,0)),greatest(reserve_before,0));
      perform budgie_private.reserve_effect(card,month_start,-account_line.amount_minor);
    elsif tx.kind = 'adjustment' and account_line.amount_minor > 0 then
      perform budgie_private.retire_debt(card,least(account_line.amount_minor,greatest(-old_balance,0)));
    end if;
  end if;
end loop;
for line in select * from public.transaction_splits where transaction_id = tx.id order by position loop
  select closing_minor into strict old_balance from public.envelope_month_balances
    where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
  update public.envelope_month_balances set closing_minor = closing_minor+line.amount_minor,activity_minor = activity_minor+line.amount_minor
    where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
  if line.amount_minor > 0 then
    perform budgie_private.cover_deficit(line.envelope_id,month_start,least(line.amount_minor,greatest(-old_balance,0)));
  else
    spend := -line.amount_minor; funded := least(spend,greatest(old_balance,0));
    wallet := 0; debt_spend := 0;
    if card is not null then
      wallet := least(card_cash,spend); card_cash := card_cash-wallet;
      debt_spend := spend-wallet;
      amount := greatest(funded-wallet,0);
      perform budgie_private.reserve_effect(card,month_start,amount);
      if wallet > funded then
        next_ordinal := next_ordinal+1;
        insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,remaining_minor)
          values (p_budget,next_ordinal,tx.id,line.position,line.envelope_id,wallet-funded);
      end if;
      if debt_spend > amount then
        next_ordinal := next_ordinal+1;
        insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,card_id,remaining_minor,eligible_minor)
          values (p_budget,next_ordinal,tx.id,line.position,line.envelope_id,card,debt_spend-amount,debt_spend-amount);
      end if;
    elsif spend > funded then
      next_ordinal := next_ordinal+1;
      insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,remaining_minor)
        values (p_budget,next_ordinal,tx.id,line.position,line.envelope_id,spend-funded);
    end if;
  end if;
end loop;
end $function$;

REVOKE ALL ON FUNCTION budgie_private.apply_transaction(uuid) FROM PUBLIC;
