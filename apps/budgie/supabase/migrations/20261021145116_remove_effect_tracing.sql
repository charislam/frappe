SET local check_function_bodies = off;

DROP FUNCTION "budgie_private"."cover_deficit"(uuid, bigint, uuid);

DROP FUNCTION "budgie_private"."reserve_effect"(uuid, bigint, uuid);

CREATE OR REPLACE FUNCTION budgie_private.cover_deficit (
  p_envelope uuid,
  p_amount   bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare lot record; used bigint; reserved bigint; debt bigint; generated bigint; left_over bigint := p_amount;
begin
  for lot in select * from pg_temp.budgie_lots where envelope_id = p_envelope and remaining > 0 order by ordinal loop
    exit when left_over <= 0;
    used := least(left_over,lot.remaining);
    generated := 0;
    if lot.card_id is not null and lot.eligible > 0 then
      select greatest(-balance,0) into debt from pg_temp.budgie_accounts where id = lot.card_id;
      select greatest(balance,0) into reserved from pg_temp.budgie_envelopes where credit_account_id = lot.card_id;
      generated := least(greatest(used-(lot.remaining-lot.eligible),0),greatest(debt-reserved,0));
      perform budgie_private.reserve_effect(lot.card_id,generated);
    end if;
    update pg_temp.budgie_lots set remaining = remaining-used, eligible = eligible-greatest(used-(lot.remaining-lot.eligible),0),
      direct_covered = direct_covered-least(direct_covered,greatest(used-(lot.remaining-lot.eligible-lot.direct_covered),0)) where ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION budgie_private.replay (
  p_budget  uuid,
  p_through date,
  p_cutoff  date DEFAULT 'infinity'::date
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  month_start date; last_month date; cached_through date; event record; line record; account_line record;
  old_balance bigint; amount bigint; spend bigint; funded bigint; wallet bigint; card_cash bigint;
  debt_spend bigint; reserve_before bigint; card uuid; tx public.transactions;
begin
  -- The caller holds the budget lock. Drop first so caller-created temporary
  -- objects can never supply tables or triggers to privileged calculation code.
  drop table if exists pg_temp.budgie_accounts,pg_temp.budgie_envelopes,pg_temp.budgie_lots;
  create temporary table budgie_accounts (id uuid primary key,kind text,balance bigint not null) on commit drop;
  create temporary table budgie_envelopes (
    id uuid primary key,kind text,credit_account_id uuid,balance bigint not null,
    opening bigint not null,allocated bigint not null,activity bigint not null
  ) on commit drop;
  create temporary table budgie_lots (
    ordinal bigint generated always as identity primary key,envelope_id uuid not null,card_id uuid,
    remaining bigint not null,eligible bigint not null,direct_covered bigint not null default 0
  ) on commit drop;
  insert into pg_temp.budgie_accounts select id,kind,0 from public.accounts where budget_id = p_budget;
  insert into pg_temp.budgie_envelopes select id,kind,credit_account_id,0,0,0,0 from public.envelopes where budget_id = p_budget;
  select max(month) into cached_through from public.envelope_month_balances where budget_id = p_budget;
  delete from public.account_balances where budget_id = p_budget;
  delete from public.envelope_month_balances where budget_id = p_budget;
  select least(date_trunc('month',p_through)::date,
    coalesce((select min(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff),p_through),
    coalesce((select min(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),p_through)) into month_start;
  month_start := date_trunc('month',month_start)::date;
  select greatest(cached_through,date_trunc('month',current_date)::date,date_trunc('month',p_through)::date,
    coalesce((select max(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),p_through),
    coalesce((select max(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff),p_through)) into last_month;
  last_month := date_trunc('month',last_month)::date;
  while month_start <= last_month loop
    update pg_temp.budgie_envelopes set opening = balance, allocated = 0,activity = 0;
    for event in
      select id,month as day,sequence,0 as priority from public.allocation_batches
        where budget_id = p_budget and voided_at is null and month = month_start
      union all
      select id,effective_date,sequence,1 from public.transactions
        where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff and effective_date >= month_start and effective_date < (month_start + interval '1 month')::date
      order by day,priority,sequence
    loop
      if event.priority = 0 then
        -- Apply the balanced batch before covering any deficits, so direct card
        -- funding in the same batch cannot also reserve the debt through a lot.
        for line in select x.*,e.credit_account_id from public.allocation_entries x join public.envelopes e on e.id = x.envelope_id
          where batch_id = event.id order by e.kind,x.envelope_id loop
          select balance into old_balance from pg_temp.budgie_envelopes where id = line.envelope_id;
          update pg_temp.budgie_envelopes set balance = balance+line.amount_minor,allocated = allocated+line.amount_minor where id = line.envelope_id;
          if line.credit_account_id is not null then
            amount := greatest(old_balance+line.amount_minor,0)-greatest(old_balance,0);
            perform budgie_private.direct_coverage(line.credit_account_id,amount);
          end if;
        end loop;
        for line in select * from public.allocation_entries where batch_id = event.id and amount_minor > 0 order by envelope_id loop
          select balance-line.amount_minor into old_balance from pg_temp.budgie_envelopes where id = line.envelope_id;
          perform budgie_private.cover_deficit(line.envelope_id,least(line.amount_minor,greatest(-old_balance,0)));
        end loop;
      else
        select * into strict tx from public.transactions where id = event.id;
        card := null; card_cash := 0;
        for account_line in select e.*,a.kind from public.account_entries e join public.accounts a on a.id = e.account_id
          where transaction_id = event.id order by position loop
          select balance into old_balance from pg_temp.budgie_accounts where id = account_line.account_id;
          update pg_temp.budgie_accounts set balance = balance+account_line.amount_minor where id = account_line.account_id;
          if account_line.kind = 'credit' then
            card := account_line.account_id;
            card_cash := greatest(old_balance,0);
            if account_line.amount_minor > 0 and (tx.kind in ('refund','transfer') or (tx.kind = 'adjustment' and exists (select 1 from public.transaction_splits where transaction_id = tx.id))) then
              select balance into reserve_before from pg_temp.budgie_envelopes where credit_account_id = card;
              perform budgie_private.retire_debt(card,least(account_line.amount_minor,greatest(-old_balance,0)),greatest(reserve_before,0));
              perform budgie_private.reserve_effect(card,-account_line.amount_minor);
            elsif tx.kind = 'adjustment' and account_line.amount_minor > 0 then
              perform budgie_private.retire_debt(card,least(account_line.amount_minor,greatest(-old_balance,0)));
            end if;
          end if;
        end loop;
        for line in select * from public.transaction_splits where transaction_id = event.id order by position loop
          select balance into old_balance from pg_temp.budgie_envelopes where id = line.envelope_id;
          update pg_temp.budgie_envelopes set balance = balance+line.amount_minor,activity = activity+line.amount_minor where id = line.envelope_id;
          if line.amount_minor > 0 then
            perform budgie_private.cover_deficit(line.envelope_id,least(line.amount_minor,greatest(-old_balance,0)));
          else
            spend := -line.amount_minor; funded := least(spend,greatest(old_balance,0));
            wallet := 0; debt_spend := 0;
            if card is not null then
              wallet := least(card_cash,spend); card_cash := card_cash-wallet;
              debt_spend := spend-wallet;
              amount := greatest(funded-wallet,0);
              perform budgie_private.reserve_effect(card,amount);
              if wallet > funded then
                insert into pg_temp.budgie_lots (envelope_id,remaining,eligible) values (line.envelope_id,wallet-funded,0);
              end if;
              if debt_spend > amount then
                insert into pg_temp.budgie_lots (envelope_id,card_id,remaining,eligible)
                  values (line.envelope_id,card,debt_spend-amount,debt_spend-amount);
              end if;
            elsif spend > funded then
              insert into pg_temp.budgie_lots (envelope_id,remaining,eligible) values (line.envelope_id,spend-funded,0);
            end if;
          end if;
        end loop;
      end if;
    end loop;
    insert into public.envelope_month_balances
      select p_budget,id,month_start,opening,allocated,activity,balance from pg_temp.budgie_envelopes;
    month_start := (month_start + interval '1 month')::date;
  end loop;
  insert into public.account_balances select p_budget,id,balance from pg_temp.budgie_accounts;
end $function$;

CREATE OR REPLACE FUNCTION budgie_private.reserve_effect (
  p_card   uuid,
  p_amount bigint
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare e uuid;
begin
  if p_amount = 0 then return; end if;
  select id into strict e from pg_temp.budgie_envelopes where credit_account_id = p_card;
  update pg_temp.budgie_envelopes set balance = balance + p_amount, activity = activity + p_amount where id = e;
end $function$;

CREATE OR REPLACE FUNCTION public.budgie_snapshot (
  p_budget uuid,
  p_month  date,
  p_as_of  date
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb;
begin
  perform budgie_private.lock_budget(p_budget);
  if p_month is null or p_as_of is null or extract(day from p_month) <> 1 then raise exception 'Month and selected as-of date required'; end if;
  perform budgie_private.replay(p_budget,greatest(p_month,p_as_of));
  with period_accounts as (
    select a.id,a.budget_id,a.kind,coalesce(sum(e.amount_minor) filter (where t.status = 'posted' and t.effective_date < (p_month + interval '1 month')::date),0)::bigint as balance_minor
    from public.accounts a left join public.account_entries e on e.account_id = a.id
      left join public.transactions t on t.id = e.transaction_id
    where a.budget_id = p_budget group by a.id
  )
  select jsonb_build_object(
    'overview',jsonb_build_object(
      'cash_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'cash'),
      'investment_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'investment'),
      'credit_debt_minor',(select coalesce(sum(greatest(-balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'credit'),
      'positive_credit_minor',(select coalesce(sum(greatest(balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = p_budget and a.kind = 'credit'),
      'negative_payment_reserve_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = p_budget and b.month = p_month and e.kind = 'credit_payment'),
      'negative_spending_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = p_budget and b.month = p_month and e.kind = 'regular'),
      'uncovered_debt_minor',(select coalesce(sum(greatest(-a.balance_minor-greatest(e.closing_minor,0),0)),0) from period_accounts a
        join public.envelopes p on p.credit_account_id = a.id join public.envelope_month_balances e on e.envelope_id = p.id and e.month = p_month where a.budget_id = p_budget)
    ),
    'budget',(select to_jsonb(b) from public.budgets b where id = p_budget),
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a) || jsonb_build_object('balance_minor',b.balance_minor) order by sort_order),'[]') from public.accounts a join public.account_balances b on b.account_id = a.id where a.budget_id = p_budget),
    'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by sort_order),'[]') from public.envelope_groups g where budget_id = p_budget),
    'envelopes',(select coalesce(jsonb_agg(to_jsonb(e) || to_jsonb(b) order by e.sort_order),'[]') from public.envelopes e join public.envelope_month_balances b on b.envelope_id = e.id where e.budget_id = p_budget and b.month = p_month),
    'ready_to_assign_minor',budgie_private.ready_available(p_budget,p_month),
    'transactions',(select coalesce(jsonb_agg(budgie_private.aggregate('transaction',t.id) order by effective_date,sequence),'[]') from public.transactions t where budget_id = p_budget),
    'allocations',(select coalesce(jsonb_agg(budgie_private.aggregate('allocation',a.id) order by month,sequence),'[]') from public.allocation_batches a where budget_id = p_budget),
    'payees',(select coalesce(jsonb_agg(to_jsonb(p) order by name),'[]') from public.payees p where budget_id = p_budget),
    'deficits',(select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('remaining_minor',l.remaining,'eligible_minor',l.eligible,'direct_covered_minor',l.direct_covered) - 'remaining' - 'eligible' - 'direct_covered' order by ordinal),'[]') from pg_temp.budgie_lots l where remaining > 0)
  ) into result;
  return budgie_private.lossless_json(result);
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."cover_deficit"(uuid, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "budgie_private"."reserve_effect"(uuid, bigint) FROM PUBLIC;
