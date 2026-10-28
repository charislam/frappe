SET local check_function_bodies = off;

DROP FUNCTION "budgie_private"."cover_deficit"(uuid, bigint);

DROP FUNCTION "budgie_private"."reserve_effect"(uuid, bigint);

CREATE TABLE "public"."deficit_lots" (
  "budget_id"            uuid    NOT NULL,
  "ordinal"              bigint  NOT NULL,
  "transaction_id"       uuid    NOT NULL,
  "position"             integer NOT NULL,
  "envelope_id"          uuid    NOT NULL,
  "card_id"              uuid,
  "remaining_minor"      bigint  NOT NULL,
  "eligible_minor"       bigint  NOT NULL DEFAULT 0,
  "direct_covered_minor" bigint  NOT NULL DEFAULT 0,
  CONSTRAINT "deficit_lots_check1" CHECK (((card_id IS NOT NULL) OR ((eligible_minor = 0) AND (direct_covered_minor = 0)))),
  CONSTRAINT "deficit_lots_check" CHECK (((eligible_minor + direct_covered_minor) <= remaining_minor)),
  CONSTRAINT "deficit_lots_direct_covered_minor_check" CHECK ((direct_covered_minor >= 0)),
  CONSTRAINT "deficit_lots_eligible_minor_check" CHECK ((eligible_minor >= 0)),
  CONSTRAINT "deficit_lots_ordinal_check" CHECK ((ordinal > 0)),
  CONSTRAINT "deficit_lots_pkey" PRIMARY KEY (budget_id, ordinal),
  CONSTRAINT "deficit_lots_position_check" CHECK (("position" >= 0)),
  CONSTRAINT "deficit_lots_remaining_minor_check" CHECK ((remaining_minor >= 0))
);

ALTER TABLE "public"."deficit_lots"
  ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE "public"."deficit_lots" FROM "anon";

CREATE OR REPLACE FUNCTION budgie_private.cover_deficit (
  p_envelope uuid,
  p_month    date,
  p_amount   bigint
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

CREATE OR REPLACE FUNCTION budgie_private.direct_coverage (
  p_card   uuid,
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
  debt_spend bigint; reserve_before bigint; card uuid; tx public.transactions; next_ordinal bigint := 0;
begin
  -- The caller holds the budget lock. MVCC readers continue seeing the previous
  -- committed generation until all summaries and lots are rebuilt atomically.
  select max(month) into cached_through from public.envelope_month_balances where budget_id = p_budget;
  delete from public.deficit_lots where budget_id = p_budget;
  delete from public.account_balances where budget_id = p_budget;
  delete from public.envelope_month_balances where budget_id = p_budget;
  insert into public.account_balances (budget_id,account_id,balance_minor)
    select p_budget,id,0 from public.accounts where budget_id = p_budget;
  select least(date_trunc('month',p_through)::date,
    coalesce((select min(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff),p_through),
    coalesce((select min(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),p_through)) into month_start;
  month_start := date_trunc('month',month_start)::date;
  select greatest(cached_through,date_trunc('month',current_date)::date,date_trunc('month',p_through)::date,
    coalesce((select max(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),p_through),
    coalesce((select max(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff),p_through)) into last_month;
  last_month := date_trunc('month',last_month)::date;
  while month_start <= last_month loop
    insert into public.envelope_month_balances (budget_id,envelope_id,month,opening_minor,allocated_minor,activity_minor,closing_minor)
      select p_budget,e.id,month_start,coalesce(previous.closing_minor,0),0,0,coalesce(previous.closing_minor,0)
      from public.envelopes e left join public.envelope_month_balances previous
        on previous.budget_id = e.budget_id and previous.envelope_id = e.id and previous.month = (month_start-interval '1 month')::date
      where e.budget_id = p_budget;
    for event in
      select id,month as day,sequence,0 as priority from public.allocation_batches
        where budget_id = p_budget and voided_at is null and month = month_start
      union all
      select id,effective_date,sequence,1 from public.transactions
        where budget_id = p_budget and status = 'posted' and effective_date <= p_cutoff and effective_date >= month_start and effective_date < (month_start+interval '1 month')::date
      order by day,priority,sequence
    loop
      if event.priority = 0 then
        -- Apply the balanced batch before covering deficits so direct funding
        -- cannot also reserve the same debt through its spending lot.
        for line in select x.*,e.credit_account_id from public.allocation_entries x join public.envelopes e on e.id = x.envelope_id
          where batch_id = event.id order by e.kind,x.envelope_id loop
          select closing_minor into strict old_balance from public.envelope_month_balances
            where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
          update public.envelope_month_balances set closing_minor = closing_minor+line.amount_minor,allocated_minor = allocated_minor+line.amount_minor
            where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
          if line.credit_account_id is not null then
            amount := greatest(old_balance+line.amount_minor,0)-greatest(old_balance,0);
            perform budgie_private.direct_coverage(line.credit_account_id,amount);
          end if;
        end loop;
        for line in select * from public.allocation_entries where batch_id = event.id and amount_minor > 0 order by envelope_id loop
          select closing_minor-line.amount_minor into strict old_balance from public.envelope_month_balances
            where budget_id = p_budget and envelope_id = line.envelope_id and month = month_start;
          perform budgie_private.cover_deficit(line.envelope_id,month_start,least(line.amount_minor,greatest(-old_balance,0)));
        end loop;
      else
        select * into strict tx from public.transactions where id = event.id;
        card := null; card_cash := 0;
        for account_line in select e.*,a.kind from public.account_entries e join public.accounts a on a.id = e.account_id
          where transaction_id = event.id order by position loop
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
        for line in select * from public.transaction_splits where transaction_id = event.id order by position loop
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
                  values (p_budget,next_ordinal,event.id,line.position,line.envelope_id,wallet-funded);
              end if;
              if debt_spend > amount then
                next_ordinal := next_ordinal+1;
                insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,card_id,remaining_minor,eligible_minor)
                  values (p_budget,next_ordinal,event.id,line.position,line.envelope_id,card,debt_spend-amount,debt_spend-amount);
              end if;
            elsif spend > funded then
              next_ordinal := next_ordinal+1;
              insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,remaining_minor)
                values (p_budget,next_ordinal,event.id,line.position,line.envelope_id,spend-funded);
            end if;
          end if;
        end loop;
      end if;
    end loop;
    month_start := (month_start+interval '1 month')::date;
  end loop;
  -- Settled lots are only needed while replay is in progress.
  delete from public.deficit_lots where budget_id = p_budget and remaining_minor = 0;
end $function$;

CREATE OR REPLACE FUNCTION budgie_private.reserve_effect (
  p_card   uuid,
  p_month  date,
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

CREATE OR REPLACE FUNCTION budgie_private.retire_debt (
  p_card     uuid,
  p_amount   bigint,
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
    'deficits',(select coalesce(jsonb_agg(to_jsonb(l) order by ordinal),'[]') from public.deficit_lots l where budget_id = p_budget and remaining_minor > 0)
  ) into result;
  return budgie_private.lossless_json(result);
end $function$;

ALTER TABLE "public"."deficit_lots"
  ADD CONSTRAINT "deficit_lots_budget_id_card_id_fkey" FOREIGN KEY (budget_id, card_id) REFERENCES public.accounts(budget_id, id);

ALTER TABLE "public"."deficit_lots"
  ADD CONSTRAINT "deficit_lots_budget_id_envelope_id_fkey" FOREIGN KEY (budget_id, envelope_id) REFERENCES public.envelopes(budget_id, id);

ALTER TABLE "public"."deficit_lots"
  ADD CONSTRAINT "deficit_lots_budget_id_transaction_id_fkey" FOREIGN KEY (budget_id, transaction_id) REFERENCES public.transactions(budget_id, id);

CREATE INDEX deficit_lots_card ON public.deficit_lots USING btree (budget_id, card_id, ordinal)
  WHERE (card_id IS NOT NULL);

CREATE INDEX deficit_lots_envelope ON public.deficit_lots USING btree (budget_id, envelope_id, ordinal);

CREATE INDEX deficit_lots_transaction ON public.deficit_lots USING btree (budget_id, transaction_id);

CREATE POLICY "owner_read" ON "public"."deficit_lots"
  FOR SELECT
  TO "authenticated"
  USING (budgie_private.is_owner(budget_id));

REVOKE ALL ON FUNCTION "budgie_private"."cover_deficit"(uuid, date, bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION "budgie_private"."reserve_effect"(uuid, date, bigint) FROM PUBLIC;

REVOKE ALL ON TABLE "public"."deficit_lots" FROM "authenticated";

GRANT SELECT ON TABLE "public"."deficit_lots" TO "authenticated";

REVOKE ALL ON TABLE "public"."deficit_lots" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."deficit_lots" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."deficit_lots" TO "service_role";

-- Data backfill: existing budgets need their derived lots populated on upgrade.
-- Cache generation remains atomic, and each budget uses the normal write lock.
do $backfill$
declare budget record;
begin
  for budget in select id from public.budgets order by id for update loop
    perform budgie_private.replay(budget.id,current_date);
  end loop;
end $backfill$;
