-- Initial Budgie migration baseline. Current declarations live in ../schemas/.
-- Authoritative records. All financial amounts are signed bigint minor units.
create schema budgie_private;
revoke all on schema budgie_private from public, anon, authenticated;
grant usage on schema budgie_private to authenticated;

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  name text not null check (btrim(name) <> ''),
  currency_code text not null check (currency_code ~ '^[A-Z]{3}$'),
  minor_unit_scale smallint not null check (minor_unit_scale between 0 and 6),
  created_at timestamptz not null default now(), archived_at timestamptz
);
create table public.budget_owners (
  budget_id uuid not null references public.budgets on delete restrict,
  user_id uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now(), primary key (budget_id, user_id)
);
create index budget_owners_user on public.budget_owners (user_id, budget_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('cash','credit','investment')),
  sort_order integer not null check (sort_order >= 0),
  created_at timestamptz not null default now(), archived_at timestamptz,
  unique (budget_id,id), unique (budget_id,sort_order) deferrable initially deferred
);
create table public.envelope_groups (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  name text not null check (btrim(name) <> ''), sort_order integer not null check (sort_order >= 0),
  archived_at timestamptz, unique (budget_id,id),
  unique (budget_id,sort_order) deferrable initially deferred
);
create table public.envelopes (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  group_id uuid, name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('regular','ready_to_assign','credit_payment')),
  credit_account_id uuid, sort_order integer not null check (sort_order >= 0), archived_at timestamptz,
  check ((kind = 'credit_payment') = (credit_account_id is not null)),
  unique (budget_id,id),
  unique nulls not distinct (budget_id,group_id,sort_order) deferrable initially deferred,
  foreign key (budget_id,group_id) references public.envelope_groups (budget_id,id),
  foreign key (budget_id,credit_account_id) references public.accounts (budget_id,id)
);
create unique index envelopes_ready on public.envelopes (budget_id) where kind = 'ready_to_assign';
create unique index envelopes_payment on public.envelopes (budget_id,credit_account_id) where kind = 'credit_payment';
create index envelopes_group on public.envelopes (budget_id,group_id);
create table public.payees (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  name text not null check (btrim(name) <> ''), created_at timestamptz not null default now(),
  archived_at timestamptz, unique (budget_id,id)
);
create unique index payees_normalized_name on public.payees (budget_id,lower(btrim(name)));
create table public.transactions (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  kind text not null check (kind in ('income','expense','refund','transfer','opening_balance','adjustment','valuation')),
  status text not null check (status in ('scheduled','posted','voided')),
  effective_date date not null, payee_id uuid, memo text,
  sequence bigint generated always as identity unique,
  version bigint not null default 1 check (version > 0),
  created_by uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (budget_id,id), foreign key (budget_id,payee_id) references public.payees (budget_id,id)
);
create index transactions_posted on public.transactions (budget_id,effective_date,sequence) where status = 'posted';
create index transactions_scheduled on public.transactions (budget_id,effective_date) where status = 'scheduled';
create index transactions_payee on public.transactions (budget_id,payee_id);
create table public.account_entries (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null,
  transaction_id uuid not null, account_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0), position integer not null check (position >= 0),
  unique (transaction_id,position),
  foreign key (budget_id,transaction_id) references public.transactions (budget_id,id),
  foreign key (budget_id,account_id) references public.accounts (budget_id,id)
);
create index account_entries_parent on public.account_entries (budget_id,transaction_id);
create index account_entries_account on public.account_entries (budget_id,account_id,transaction_id);
create table public.transaction_splits (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null,
  transaction_id uuid not null, envelope_id uuid not null,
  amount_minor bigint not null check (amount_minor <> 0), position integer not null check (position >= 0),
  unique (transaction_id,position),
  foreign key (budget_id,transaction_id) references public.transactions (budget_id,id),
  foreign key (budget_id,envelope_id) references public.envelopes (budget_id,id)
);
create index transaction_splits_parent on public.transaction_splits (budget_id,transaction_id);
create index transaction_splits_envelope on public.transaction_splits (budget_id,envelope_id);
create table public.allocation_batches (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  month date not null check (extract(day from month) = 1),
  sequence bigint generated always as identity unique,
  memo text, version bigint not null default 1 check (version > 0), voided_at timestamptz,
  created_by uuid not null references auth.users on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (budget_id,id)
);
create index allocation_batches_month on public.allocation_batches (budget_id,month,sequence);
create table public.allocation_entries (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null,
  batch_id uuid not null, envelope_id uuid not null, amount_minor bigint not null check (amount_minor <> 0),
  unique (batch_id,envelope_id),
  foreign key (budget_id,batch_id) references public.allocation_batches (budget_id,id),
  foreign key (budget_id,envelope_id) references public.envelopes (budget_id,id)
);
create index allocation_entries_parent on public.allocation_entries (budget_id,batch_id);
create index allocation_entries_envelope on public.allocation_entries (budget_id,envelope_id);
create table public.audit_events (
  id uuid primary key default gen_random_uuid(), budget_id uuid not null references public.budgets,
  actor_user_id uuid, recorded_at timestamptz not null default now(), operation text not null,
  entity_type text not null, entity_id uuid not null, before_data jsonb, after_data jsonb, request_id uuid not null
);
create index audit_events_entity on public.audit_events (budget_id,entity_type,entity_id,recorded_at);
create table public.write_requests (
  budget_id uuid not null references public.budgets, request_id uuid not null, actor_user_id uuid not null,
  payload_hash text not null, result jsonb not null, created_at timestamptz not null default now(),
  primary key (budget_id,request_id)
);
create table public.account_balances (
  budget_id uuid not null, account_id uuid not null, balance_minor bigint not null,
  primary key (budget_id,account_id), foreign key (budget_id,account_id) references public.accounts (budget_id,id)
);
create table public.envelope_month_balances (
  budget_id uuid not null, envelope_id uuid not null,
  month date not null check (extract(day from month) = 1),
  opening_minor bigint not null, allocated_minor bigint not null,
  activity_minor bigint not null, closing_minor bigint not null,
  check (closing_minor = opening_minor + allocated_minor + activity_minor),
  primary key (budget_id,envelope_id,month),
  foreign key (budget_id,envelope_id) references public.envelopes (budget_id,id)
);
create index envelope_month_balances_month on public.envelope_month_balances (budget_id,month,envelope_id);

create function budgie_private.is_owner(p_budget uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.budget_owners where budget_id = p_budget and user_id = (select auth.uid()));
$$;
revoke all on function budgie_private.is_owner(uuid) from public, anon;
grant execute on function budgie_private.is_owner(uuid) to authenticated;

do $$
declare t text;
begin
  foreach t in array array['budgets','budget_owners','accounts','envelope_groups','envelopes','payees',
    'transactions','account_entries','transaction_splits','allocation_batches','allocation_entries',
    'audit_events','write_requests','account_balances','envelope_month_balances'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create policy owner_read on public.%I for select to authenticated using (budgie_private.is_owner(%I))',
      t, case when t = 'budgets' then 'id' else 'budget_id' end);
  end loop;
end $$;

-- Aggregate validation is shared by commands and deferred constraint triggers.
create function budgie_private.validate_transaction(p_id uuid) returns void
language plpgsql set search_path = '' as $$
declare
  t public.transactions; n integer; s integer; total numeric; split_total numeric;
  a record; b record; ready uuid; target numeric;
begin
  select * into t from public.transactions where id = p_id;
  if not found then return; end if;
  select count(*),coalesce(sum(amount_minor),0) into n,total from public.account_entries where transaction_id = p_id;
  select count(*),coalesce(sum(amount_minor),0) into s,split_total from public.transaction_splits where transaction_id = p_id;
  if n = 0 or exists (select 1 from public.account_entries where transaction_id = p_id group by transaction_id having max(position) <> count(*)-1)
    or exists (select 1 from public.transaction_splits where transaction_id = p_id group by transaction_id having max(position) <> count(*)-1) then
    raise exception 'Invalid transaction line positions or missing account entry';
  end if;
  select e.*,ac.kind into a from public.account_entries e join public.accounts ac on ac.id = e.account_id
    where e.transaction_id = p_id order by position limit 1;
  select id into ready from public.envelopes where budget_id = t.budget_id and kind = 'ready_to_assign';
  if t.kind = 'transfer' then
    if n <> 2 or total <> 0 then raise exception 'Transfers require two opposite entries'; end if;
    select e.*,ac.kind into a from public.account_entries e join public.accounts ac on ac.id = e.account_id
      where e.transaction_id = p_id and e.amount_minor < 0;
    select e.*,ac.kind into b from public.account_entries e join public.accounts ac on ac.id = e.account_id
      where e.transaction_id = p_id and e.amount_minor > 0;
    if a.account_id = b.account_id or (a.kind,b.kind) not in
      (('cash','cash'),('cash','credit'),('cash','investment'),('investment','cash'),('investment','investment')) then
      raise exception 'Unsupported transfer route';
    end if;
    if (a.kind,b.kind) = ('cash','investment') then target := a.amount_minor;
    elsif (a.kind,b.kind) = ('investment','cash') then target := b.amount_minor;
    else target := 0; end if;
    if split_total <> target or (target = 0 and s <> 0) or (target <> 0 and s = 0) or exists (select 1 from public.transaction_splits where transaction_id = p_id and sign(amount_minor) <> sign(target)) then
      raise exception 'Transfer splits do not match budget movement';
    end if;
  else
    if n <> 1 then raise exception 'Transaction requires one account entry'; end if;
    case t.kind
      when 'valuation' then
        if a.kind <> 'investment' or s <> 0 then raise exception 'Valuation requires investment and no splits'; end if;
      when 'opening_balance' then
        if a.kind = 'cash' or (a.kind = 'credit' and a.amount_minor > 0) then
          if s <> 1 or split_total <> total or exists (select 1 from public.transaction_splits where transaction_id = p_id and envelope_id <> ready) then
            raise exception 'Opening balance requires matching Ready to assign split';
          end if;
        elsif s <> 0 then raise exception 'Debt and investment openings have no splits'; end if;
      when 'adjustment' then
        if nullif(btrim(t.memo),'') is null then raise exception 'Adjustment requires a reason'; end if;
        if a.kind = 'investment' then
          if s <> 0 then raise exception 'Investment adjustment cannot have splits'; end if;
        elsif a.kind = 'credit' and s = 0 then
          -- Explicit no-split credit adjustment uses opening-debt semantics.
          null;
        elsif split_total <> total or s = 0 then raise exception 'Adjustment splits must match account entry'; end if;
      else
        if a.kind = 'investment' or split_total <> total or s = 0 then raise exception 'Invalid categorized account activity'; end if;
        if (t.kind in ('income','refund') and total <= 0) or (t.kind = 'expense' and total >= 0) then
          raise exception 'Invalid transaction sign';
        end if;
    end case;
  end if;
  if exists (select 1 from public.transaction_splits x join public.envelopes e on e.id = x.envelope_id
    where x.transaction_id = p_id and (e.kind = 'credit_payment' or
      (t.kind = 'refund' and e.kind <> 'regular') or
      (x.amount_minor > 0 and total < 0 and t.kind <> 'transfer') or
      (x.amount_minor < 0 and total > 0 and t.kind <> 'transfer'))) then
    raise exception 'Invalid split destination or sign';
  end if;
end $$;

create function budgie_private.validate_budget(p_budget uuid) returns void
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.budgets where id = p_budget) then return; end if;
  if not exists (select 1 from public.budget_owners where budget_id = p_budget) then raise exception 'A budget must retain an owner'; end if;
  if (select count(*) from public.envelopes where budget_id = p_budget and kind = 'ready_to_assign') <> 1 then
    raise exception 'A budget must have one Ready to assign envelope'; end if;
  if exists (select 1 from public.accounts a left join public.envelopes e on e.budget_id = a.budget_id and e.credit_account_id = a.id
      where a.budget_id = p_budget and ((a.kind = 'credit' and e.id is null) or (a.kind <> 'credit' and e.id is not null))) then
    raise exception 'Credit accounts require exactly one payment envelope'; end if;
  if exists (select 1 from public.allocation_batches b left join public.allocation_entries e on e.batch_id = b.id
    where b.budget_id = p_budget group by b.id having count(e.id) < 2 or sum(e.amount_minor) <> 0) then
    raise exception 'Allocation batches require balanced entries'; end if;
end $$;

create function budgie_private.check_aggregate() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payload jsonb := coalesce(to_jsonb(new),to_jsonb(old));
begin
  if tg_table_name in ('transactions','account_entries','transaction_splits') then
    perform budgie_private.validate_transaction(case when tg_table_name = 'transactions' then (payload->>'id')::uuid else (payload->>'transaction_id')::uuid end);
  else
    perform budgie_private.validate_budget(case when tg_table_name = 'budgets' then (payload->>'id')::uuid else (payload->>'budget_id')::uuid end);
  end if;
  return null;
end $$;
do $$ declare t text; begin
  foreach t in array array['budgets','budget_owners','accounts','envelopes','allocation_batches','allocation_entries','transactions','account_entries','transaction_splits'] loop
    execute format('create constraint trigger validate_aggregate after insert or update or delete on public.%I deferrable initially deferred for each row execute function budgie_private.check_aggregate()',t);
  end loop;
end $$;

create function budgie_private.protect_identity() returns trigger
language plpgsql set search_path = '' as $$
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
end $$;
do $$ declare t text; begin
  foreach t in array array['budgets','accounts','envelopes','transactions','allocation_batches'] loop
    execute format('create trigger protect_identity before update on public.%I for each row execute function budgie_private.protect_identity()',t);
  end loop;
end $$;

-- Replay scratch state lives only in session-local temporary relations and is rebuilt
-- from authoritative rows. Helpers are private and are never client-callable.
create function budgie_private.reserve_effect(p_card uuid, p_amount bigint, p_source uuid) returns void
language plpgsql set search_path = '' as $$
declare e uuid;
begin
  if p_amount = 0 then return; end if;
  select id into strict e from pg_temp.budgie_envelopes where credit_account_id = p_card;
  update pg_temp.budgie_envelopes set balance = balance + p_amount, activity = activity + p_amount where id = e;
  insert into pg_temp.budgie_effects values (p_source,e,p_amount);
end $$;

-- Direct reservation can be released again. Paid debt cannot. Keep both
-- separate from the unchanged arithmetic of the original spending deficit.
create function budgie_private.direct_coverage(p_card uuid,p_amount bigint) returns void
language plpgsql set search_path = '' as $$
declare lot record; used bigint; left_over bigint := abs(p_amount);
begin
  for lot in select * from pg_temp.budgie_lots where card_id = p_card
    order by case when p_amount > 0 then ordinal else -ordinal end loop
    exit when left_over = 0;
    if p_amount > 0 then
      used := least(left_over,lot.eligible);
      update pg_temp.budgie_lots set eligible = eligible-used,direct_covered = direct_covered+used where ordinal = lot.ordinal;
    else
      used := least(left_over,lot.direct_covered);
      update pg_temp.budgie_lots set eligible = eligible+used,direct_covered = direct_covered-used where ordinal = lot.ordinal;
    end if;
    left_over := left_over-used;
  end loop;
end $$;

create function budgie_private.retire_debt(p_card uuid,p_amount bigint,p_reserved bigint default 0) returns void
language plpgsql set search_path = '' as $$
declare lot record; used bigint; direct_total bigint; left_over bigint;
begin
  select coalesce(sum(direct_covered),0) into direct_total from pg_temp.budgie_lots where card_id = p_card;
  left_over := greatest(p_amount-greatest(p_reserved-direct_total,0),0);
  for lot in select * from pg_temp.budgie_lots where card_id = p_card and direct_covered > 0 order by ordinal loop
    exit when left_over = 0;
    used := least(left_over,lot.direct_covered);
    update pg_temp.budgie_lots set direct_covered = direct_covered-used where ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
  for lot in select * from pg_temp.budgie_lots where card_id = p_card and eligible > 0 order by ordinal loop
    exit when left_over = 0;
    used := least(left_over,lot.eligible);
    update pg_temp.budgie_lots set eligible = eligible-used where ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
end $$;

create function budgie_private.cover_deficit(p_envelope uuid,p_amount bigint,p_source uuid) returns void
language plpgsql set search_path = '' as $$
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
      perform budgie_private.reserve_effect(lot.card_id,generated,p_source);
    end if;
    update pg_temp.budgie_lots set remaining = remaining-used, eligible = eligible-greatest(used-(lot.remaining-lot.eligible),0),
      direct_covered = direct_covered-least(direct_covered,greatest(used-(lot.remaining-lot.eligible-lot.direct_covered),0)) where ordinal = lot.ordinal;
    left_over := left_over-used;
  end loop;
end $$;

create function budgie_private.replay(p_budget uuid,p_through date,p_cutoff date default 'infinity') returns void
language plpgsql set search_path = '' as $$
declare
  month_start date; last_month date; cached_through date; event record; line record; account_line record;
  old_balance bigint; amount bigint; spend bigint; funded bigint; wallet bigint; card_cash bigint;
  debt_spend bigint; reserve_before bigint; card uuid; tx public.transactions;
begin
  -- The caller holds the budget lock. Drop first so caller-created temporary
  -- objects can never supply tables or triggers to privileged calculation code.
  drop table if exists pg_temp.budgie_accounts,pg_temp.budgie_envelopes,pg_temp.budgie_lots,pg_temp.budgie_effects;
  create temporary table budgie_accounts (id uuid primary key,kind text,balance bigint not null) on commit drop;
  create temporary table budgie_envelopes (
    id uuid primary key,kind text,credit_account_id uuid,balance bigint not null,
    opening bigint not null,allocated bigint not null,activity bigint not null
  ) on commit drop;
  create temporary table budgie_lots (
    ordinal bigint generated always as identity primary key,envelope_id uuid not null,card_id uuid,
    remaining bigint not null,eligible bigint not null,direct_covered bigint not null default 0
  ) on commit drop;
  create temporary table budgie_effects (source_id uuid,envelope_id uuid,amount_minor bigint) on commit drop;
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
          perform budgie_private.cover_deficit(line.envelope_id,least(line.amount_minor,greatest(-old_balance,0)),event.id);
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
              perform budgie_private.reserve_effect(card,-account_line.amount_minor,event.id);
            elsif tx.kind = 'adjustment' and account_line.amount_minor > 0 then
              perform budgie_private.retire_debt(card,least(account_line.amount_minor,greatest(-old_balance,0)));
            end if;
          end if;
        end loop;
        for line in select * from public.transaction_splits where transaction_id = event.id order by position loop
          select balance into old_balance from pg_temp.budgie_envelopes where id = line.envelope_id;
          update pg_temp.budgie_envelopes set balance = balance+line.amount_minor,activity = activity+line.amount_minor where id = line.envelope_id;
          if line.amount_minor > 0 then
            perform budgie_private.cover_deficit(line.envelope_id,least(line.amount_minor,greatest(-old_balance,0)),event.id);
          else
            spend := -line.amount_minor; funded := least(spend,greatest(old_balance,0));
            wallet := 0; debt_spend := 0;
            if card is not null then
              wallet := least(card_cash,spend); card_cash := card_cash-wallet;
              debt_spend := spend-wallet;
              amount := greatest(funded-wallet,0);
              perform budgie_private.reserve_effect(card,amount,event.id);
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
end $$;

-- Month display uses the current plan, including signed later reservations once.
create function budgie_private.ready_available(p_budget uuid,p_month date) returns bigint
language sql stable set search_path = '' as $$
  select coalesce((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id
    where b.budget_id = p_budget and e.kind = 'ready_to_assign' and b.month = date_trunc('month',p_month)::date),0)
    + coalesce((select sum(x.amount_minor) from public.allocation_entries x
      join public.allocation_batches a on a.id = x.batch_id join public.envelopes e on e.id = x.envelope_id
      where a.budget_id = p_budget and a.voided_at is null and e.kind = 'ready_to_assign' and a.month > date_trunc('month',p_month)::date),0);
$$;

create function budgie_private.lock_budget(p_budget uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  perform 1 from public.budgets where id = p_budget for update;
  if not found or not budgie_private.is_owner(p_budget) then raise exception 'Budget access denied' using errcode = '42501'; end if;
  return actor;
end $$;

create function budgie_private.aggregate(p_kind text,p_id uuid) returns jsonb
language sql stable set search_path = '' as $$
  select case p_kind
    when 'transaction' then (select to_jsonb(t) || jsonb_build_object(
      'entries',coalesce((select jsonb_agg(to_jsonb(e) order by position) from public.account_entries e where transaction_id = t.id),'[]'),
      'splits',coalesce((select jsonb_agg(to_jsonb(s) order by position) from public.transaction_splits s where transaction_id = t.id),'[]'))
      from public.transactions t where id = p_id)
    when 'allocation' then (select to_jsonb(a) || jsonb_build_object(
      'entries',coalesce((select jsonb_agg(to_jsonb(e) order by envelope_id) from public.allocation_entries e where batch_id = a.id),'[]'))
      from public.allocation_batches a where id = p_id)
    else null end;
$$;

-- A single named JSON command keeps aggregate changes, authorization, cache
-- refresh, audit, and request deduplication inside one database transaction.
create function public.budgie_command(p_budget uuid,p_request uuid,p_command jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_variable
declare
  actor uuid; op text := p_command->>'operation'; data jsonb := coalesce(p_command->'data','{}');
  id uuid := coalesce((p_command->>'id')::uuid,gen_random_uuid());
  as_of date := (p_command->>'as_of')::date; old_data jsonb; new_data jsonb; result jsonb;
  saved public.write_requests; expected bigint := (p_command->>'expected_version')::bigint;
  hash text := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  line jsonb; item record; entity text; month date; ready_before bigint; funding_before jsonb;
  target_group uuid; previous_group uuid; ids uuid[]; count_expected integer; target_user uuid;
  recorded bigint; observed bigint; difference bigint; account uuid; normalized text;
begin
  actor := budgie_private.lock_budget(p_budget);
  if p_request is null or op is null or jsonb_typeof(p_command) <> 'object' then raise exception 'Request and operation required'; end if;
  select * into saved from public.write_requests where budget_id = p_budget and request_id = p_request;
  if found then
    if saved.actor_user_id <> actor or saved.payload_hash <> hash then raise exception 'Request ID reused with different actor or payload'; end if;
    return saved.result;
  end if;
  if op not in ('owner_add','owner_remove','rebuild') and exists (select 1 from public.budgets where id = p_budget and archived_at is not null) then
    raise exception 'Budget is archived'; end if;
  case op
    when 'owner_add','owner_remove' then
      entity := 'owner'; target_user := (data->>'user_id')::uuid; id := target_user;
      select to_jsonb(o) into old_data from public.budget_owners o where budget_id = p_budget and user_id = target_user;
      if op = 'owner_add' then
        insert into public.budget_owners (budget_id,user_id) values (p_budget,target_user) on conflict do nothing;
      else
        if (select count(*) from public.budget_owners where budget_id = p_budget) <= 1 then raise exception 'Cannot remove final owner'; end if;
        delete from public.budget_owners where budget_id = p_budget and user_id = target_user;
      end if;
      select to_jsonb(o) into new_data from public.budget_owners o where budget_id = p_budget and user_id = target_user;
    when 'budget_update' then
      entity := 'budget'; id := p_budget;
      select to_jsonb(b) into old_data from public.budgets b where b.id = p_budget;
      update public.budgets set name = coalesce(data->>'name',name),currency_code = coalesce(data->>'currency_code',currency_code),
        minor_unit_scale = coalesce((data->>'minor_unit_scale')::smallint,minor_unit_scale),
        archived_at = case when data ? 'archived' then case when (data->>'archived')::boolean then now() end else archived_at end where budgets.id = p_budget;
      select to_jsonb(b) into new_data from public.budgets b where b.id = p_budget;
    when 'account_create' then
      entity := 'account';
      insert into public.accounts (id,budget_id,name,kind,sort_order) select id,p_budget,data->>'name',data->>'kind',coalesce(max(sort_order)+1,0) from public.accounts where budget_id = p_budget;
      if data->>'kind' = 'credit' then
        insert into public.envelopes (budget_id,name,kind,credit_account_id,sort_order)
          select p_budget,data->>'name','credit_payment',id,coalesce(max(sort_order)+1,0) from public.envelopes where budget_id = p_budget and group_id is null;
      end if;
      select to_jsonb(a) into new_data from public.accounts a where a.id = id;
    when 'group_create' then
      entity := 'group';
      insert into public.envelope_groups (id,budget_id,name,sort_order) select id,p_budget,data->>'name',coalesce(max(sort_order)+1,0) from public.envelope_groups where budget_id = p_budget;
      select to_jsonb(g) into new_data from public.envelope_groups g where g.id = id;
    when 'envelope_create' then
      entity := 'envelope'; target_group := (data->>'group_id')::uuid;
      if target_group is not null and not exists (select 1 from public.envelope_groups where budget_id = p_budget and envelope_groups.id = target_group and archived_at is null) then raise exception 'Invalid group'; end if;
      insert into public.envelopes (id,budget_id,group_id,name,kind,sort_order) select id,p_budget,target_group,data->>'name','regular',coalesce(max(sort_order)+1,0) from public.envelopes where budget_id = p_budget and group_id is not distinct from target_group;
      select to_jsonb(e) into new_data from public.envelopes e where e.id = id;
    when 'payee_save' then
      entity := 'payee'; normalized := lower(btrim(data->>'name'));
      select to_jsonb(p) into old_data from public.payees p where p.budget_id = p_budget and p.id = id;
      if old_data is null then
        select p.id into account from public.payees p where p.budget_id = p_budget and lower(btrim(p.name)) = normalized;
        if found then id := account;
        else insert into public.payees (id,budget_id,name) values (id,p_budget,btrim(data->>'name')); end if;
      else
        update public.payees p set name = btrim(data->>'name') where p.id = id and p.budget_id = p_budget;
      end if;
      select to_jsonb(p) into new_data from public.payees p where p.id = id and p.budget_id = p_budget;
    when 'account_update','group_update','envelope_update','payee_archive' then
      entity := split_part(op,'_',1);
      case entity
        when 'account' then
          select to_jsonb(a) into old_data from public.accounts a where a.id = id and budget_id = p_budget;
          update public.accounts a set name = coalesce(data->>'name',a.name),kind = coalesce(data->>'kind',a.kind),
            archived_at = case when data ? 'archived' then case when (data->>'archived')::boolean then now() end else a.archived_at end
            where a.id = id and budget_id = p_budget;
          select to_jsonb(a) into new_data from public.accounts a where a.id = id and budget_id = p_budget;
        when 'group' then
          select to_jsonb(g) into old_data from public.envelope_groups g where g.id = id and budget_id = p_budget;
          update public.envelope_groups g set name = coalesce(data->>'name',g.name),archived_at = case when data ? 'archived' then case when (data->>'archived')::boolean then now() end else g.archived_at end where g.id = id and budget_id = p_budget;
          select to_jsonb(g) into new_data from public.envelope_groups g where g.id = id and budget_id = p_budget;
        when 'envelope' then
          select to_jsonb(e) into old_data from public.envelopes e where e.id = id and budget_id = p_budget;
          update public.envelopes e set name = coalesce(data->>'name',e.name),archived_at = case when data ? 'archived' then case when (data->>'archived')::boolean then now() end else e.archived_at end where e.id = id and budget_id = p_budget;
          select to_jsonb(e) into new_data from public.envelopes e where e.id = id and budget_id = p_budget;
        else
          select to_jsonb(p) into old_data from public.payees p where p.id = id and budget_id = p_budget;
          update public.payees p set archived_at = case when coalesce((data->>'archived')::boolean,true) then now() end where p.id = id and budget_id = p_budget;
          select to_jsonb(p) into new_data from public.payees p where p.id = id and budget_id = p_budget;
      end case;
      if old_data is null then raise exception 'Entity not found'; end if;
    when 'reorder' then
      entity := data->>'entity'; target_group := (data->>'group_id')::uuid;
      if jsonb_typeof(data->'ids') is distinct from 'array' then raise exception 'Ordering requires an IDs array'; end if;
      select coalesce(array_agg(value::uuid order by ordinality),'{}'::uuid[]) into ids from jsonb_array_elements_text(data->'ids') with ordinality;
      if cardinality(ids) is distinct from (select count(distinct x) from unnest(ids) x) then raise exception 'Duplicate ordering IDs'; end if;
      if entity = 'account' then
        select jsonb_agg(to_jsonb(a) order by sort_order) into old_data from public.accounts a where budget_id = p_budget;
        select count(*) into count_expected from public.accounts where budget_id = p_budget;
        if cardinality(ids) <> count_expected or exists (select 1 from unnest(ids) x where not exists (select 1 from public.accounts a where a.id = x and budget_id = p_budget)) then raise exception 'Ordering requires complete scope'; end if;
        update public.accounts a set sort_order = x.ordinality-1 from unnest(ids) with ordinality x(id,ordinality) where a.id = x.id and a.budget_id = p_budget;
        select jsonb_agg(to_jsonb(a) order by sort_order) into new_data from public.accounts a where budget_id = p_budget;
      elsif entity = 'group' then
        select jsonb_agg(to_jsonb(g) order by sort_order) into old_data from public.envelope_groups g where budget_id = p_budget;
        select count(*) into count_expected from public.envelope_groups where budget_id = p_budget;
        if cardinality(ids) <> count_expected or exists (select 1 from unnest(ids) x where not exists (select 1 from public.envelope_groups g where g.id = x and budget_id = p_budget)) then raise exception 'Ordering requires complete scope'; end if;
        update public.envelope_groups g set sort_order = x.ordinality-1 from unnest(ids) with ordinality x(id,ordinality) where g.id = x.id and g.budget_id = p_budget;
        select jsonb_agg(to_jsonb(g) order by sort_order) into new_data from public.envelope_groups g where budget_id = p_budget;
      elsif entity = 'envelope' then
        select jsonb_agg(to_jsonb(e) order by sort_order) into old_data from public.envelopes e where budget_id = p_budget and group_id is not distinct from target_group;
        select count(*) into count_expected from public.envelopes where budget_id = p_budget and group_id is not distinct from target_group;
        if cardinality(ids) <> count_expected or exists (select 1 from unnest(ids) x where not exists (select 1 from public.envelopes e where e.id = x and budget_id = p_budget and group_id is not distinct from target_group)) then raise exception 'Ordering requires complete scope'; end if;
        update public.envelopes e set sort_order = x.ordinality-1 from unnest(ids) with ordinality x(id,ordinality) where e.id = x.id and e.budget_id = p_budget;
        select jsonb_agg(to_jsonb(e) order by sort_order) into new_data from public.envelopes e where budget_id = p_budget and group_id is not distinct from target_group;
      else raise exception 'Invalid ordering entity'; end if;
    when 'envelope_move' then
      entity := 'envelope'; target_group := (data->>'group_id')::uuid;
      select to_jsonb(e),e.group_id into old_data,previous_group from public.envelopes e where e.id = id and budget_id = p_budget;
      if old_data is null then raise exception 'Envelope not found'; end if;
      if target_group is not null and not exists (select 1 from public.envelope_groups g where g.id = target_group and budget_id = p_budget and archived_at is null) then raise exception 'Invalid group'; end if;
      update public.envelopes e set group_id = target_group,sort_order = (select coalesce(max(sort_order)+1,0) from public.envelopes where budget_id = p_budget and group_id is not distinct from target_group) where e.id = id;
      update public.envelopes e set sort_order = x.position from (select e2.id,row_number() over (partition by group_id order by sort_order)-1 as position from public.envelopes e2 where budget_id = p_budget and (group_id is not distinct from previous_group or group_id is not distinct from target_group)) x where e.id = x.id;
      select to_jsonb(e) into new_data from public.envelopes e where e.id = id;
    when 'transaction_save','transaction_post','transaction_void','reconcile' then
      entity := 'transaction';
      if as_of is null then raise exception 'Selected as-of date required'; end if;
      if op = 'reconcile' then
        account := (data->>'account_id')::uuid;
        perform 1 from public.accounts a where a.id = account and budget_id = p_budget and archived_at is null;
        if not found then raise exception 'Active account required'; end if;
        select coalesce(sum(e.amount_minor),0) into recorded from public.account_entries e join public.transactions t on t.id = e.transaction_id where e.account_id = account and t.status = 'posted' and t.effective_date <= (data->>'effective_date')::date;
        if recorded is distinct from (data->>'expected_recorded_minor')::bigint then raise exception 'Stale reconciliation preview'; end if;
        observed := (data->>'observed_minor')::bigint; difference := observed-recorded;
        if difference = 0 then result := jsonb_build_object('id',null,'difference_minor','0');
        else
          data := jsonb_build_object('kind','adjustment','status','posted','effective_date',data->>'effective_date',
            'memo','Reconciliation: ' || coalesce(data->>'memo','observed balance correction'),
            'entries',jsonb_build_array(jsonb_build_object('account_id',account,'amount_minor',difference::text)),
            'splits',coalesce(data->'splits','[]'));
        end if;
      end if;
      if result is null then
        old_data := budgie_private.aggregate('transaction',id);
        if old_data is not null and (old_data->>'budget_id')::uuid <> p_budget then raise exception 'Transaction not found'; end if;
        if old_data is not null and expected is distinct from (old_data->>'version')::bigint then raise exception 'Stale transaction version' using errcode = '40001'; end if;
        if op in ('transaction_post','transaction_void') then
          if old_data is null then raise exception 'Transaction not found'; end if;
          if op = 'transaction_post' and old_data->>'status' = 'voided' then raise exception 'Voided transaction cannot be posted'; end if;
          if op = 'transaction_post' and (old_data->>'effective_date')::date > as_of then raise exception 'Schedule is not due'; end if;
          if op = 'transaction_post' and old_data->>'status' = 'scheduled' and (
            exists (select 1 from public.account_entries e join public.accounts a on a.id = e.account_id where e.transaction_id = id and a.archived_at is not null)
            or exists (select 1 from public.transaction_splits s join public.envelopes e on e.id = s.envelope_id left join public.envelope_groups g on g.id = e.group_id where s.transaction_id = id and (e.archived_at is not null or g.archived_at is not null))
            or exists (select 1 from public.payees p where p.id = (old_data->>'payee_id')::uuid and p.archived_at is not null)
          ) then raise exception 'Cannot post schedule with archived entities'; end if;
          if (op = 'transaction_post' and old_data->>'status' <> 'posted') or (op = 'transaction_void' and old_data->>'status' <> 'voided') then
            update public.transactions t set status = case op when 'transaction_post' then 'posted' else 'voided' end, version = version+1,updated_at = now() where t.id = id;
          end if;
        else
          if coalesce(data->>'status','posted') = 'posted' and (data->>'effective_date')::date > as_of then raise exception 'Cannot post future activity'; end if;
          if coalesce(data->>'status','posted') = 'voided' then raise exception 'Use transaction_void'; end if;
          if old_data is null then
            insert into public.transactions (id,budget_id,kind,status,effective_date,payee_id,memo,created_by)
              values (id,p_budget,data->>'kind',coalesce(data->>'status','posted'),(data->>'effective_date')::date,(data->>'payee_id')::uuid,data->>'memo',actor);
          else
            if old_data->>'status' = 'voided' then raise exception 'Voided transaction cannot be edited'; end if;
            update public.transactions t set kind = data->>'kind',status = coalesce(data->>'status','posted'),effective_date = (data->>'effective_date')::date,
              payee_id = (data->>'payee_id')::uuid,memo = data->>'memo',version = version+1,updated_at = now() where t.id = id;
            delete from public.account_entries where transaction_id = id;
            delete from public.transaction_splits where transaction_id = id;
          end if;
          if exists (select 1 from public.payees p where p.id = (data->>'payee_id')::uuid and (p.budget_id <> p_budget or p.archived_at is not null)) then raise exception 'Inactive or foreign payee'; end if;
          for item in select value,ordinality-1 as position from jsonb_array_elements(data->'entries') with ordinality loop
            if not exists (select 1 from public.accounts a where a.id = (item.value->>'account_id')::uuid and a.budget_id = p_budget and a.archived_at is null) then raise exception 'Active budget account required'; end if;
            insert into public.account_entries (budget_id,transaction_id,account_id,amount_minor,position) values (p_budget,id,(item.value->>'account_id')::uuid,(item.value->>'amount_minor')::bigint,item.position);
          end loop;
          for item in select value,ordinality-1 as position from jsonb_array_elements(data->'splits') with ordinality loop
            if not exists (select 1 from public.envelopes e left join public.envelope_groups g on g.id = e.group_id where e.id = (item.value->>'envelope_id')::uuid and e.budget_id = p_budget and e.archived_at is null and g.archived_at is null) then raise exception 'Active budget envelope required'; end if;
            insert into public.transaction_splits (budget_id,transaction_id,envelope_id,amount_minor,position) values (p_budget,id,(item.value->>'envelope_id')::uuid,(item.value->>'amount_minor')::bigint,item.position);
          end loop;
        end if;
        perform budgie_private.validate_transaction(id);
        new_data := budgie_private.aggregate('transaction',id);
      end if;
    when 'allocation_save','allocation_void' then
      entity := 'allocation';
      if as_of is null then raise exception 'Selected as-of date required'; end if;
      old_data := budgie_private.aggregate('allocation',id);
      if old_data is not null and (old_data->>'budget_id')::uuid <> p_budget then raise exception 'Allocation not found'; end if;
      if old_data is not null and expected is distinct from (old_data->>'version')::bigint then raise exception 'Stale allocation version' using errcode = '40001'; end if;
      month := coalesce((data->>'month')::date,(old_data->>'month')::date);
      if month is null or extract(day from month) <> 1 then raise exception 'Allocation month must be first day'; end if;
      -- Capacity excludes all income after the selected day, including schedules.
      -- Materialize both old and new horizons to compare projected source funding.
      perform budgie_private.replay(p_budget,greatest(as_of,month),as_of);
      ready_before := budgie_private.ready_available(p_budget,as_of);
      select coalesce(jsonb_object_agg(envelope_id::text || ':' || b.month::text,case when b.month > date_trunc('month',as_of)::date then least(opening_minor+allocated_minor,closing_minor) else closing_minor end),'{}') into funding_before
        from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = p_budget and e.kind <> 'ready_to_assign';
      if op = 'allocation_void' then
        if old_data is null then raise exception 'Allocation not found'; end if;
        if old_data->>'voided_at' is null then
          update public.allocation_batches a set voided_at = now(),version = version+1,updated_at = now() where a.id = id;
        end if;
      else
        if old_data is null then
          insert into public.allocation_batches (id,budget_id,month,memo,created_by) values (id,p_budget,month,data->>'memo',actor);
        else
          if old_data->>'voided_at' is not null then raise exception 'Voided allocation cannot be edited'; end if;
          update public.allocation_batches a set month = month,memo = data->>'memo',version = version+1,updated_at = now() where a.id = id;
          delete from public.allocation_entries where batch_id = id;
        end if;
        for line in select value from jsonb_array_elements(data->'entries') loop
          if not exists (select 1 from public.envelopes e left join public.envelope_groups g on g.id = e.group_id
            where e.id = (line->>'envelope_id')::uuid and e.budget_id = p_budget and e.archived_at is null and g.archived_at is null
            and (e.credit_account_id is null or exists (select 1 from public.accounts a where a.id = e.credit_account_id and a.archived_at is null))) then
            raise exception 'Active budget envelope required'; end if;
          insert into public.allocation_entries (budget_id,batch_id,envelope_id,amount_minor) values (p_budget,id,(line->>'envelope_id')::uuid,(line->>'amount_minor')::bigint);
        end loop;
      end if;
      perform budgie_private.validate_budget(p_budget);
      perform budgie_private.replay(p_budget,greatest(as_of,month),as_of);
      if budgie_private.ready_available(p_budget,as_of) < least(ready_before,0) then raise exception 'Allocation exceeds available money'; end if;
      if exists (select 1 from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id
        where b.budget_id = p_budget and e.kind <> 'ready_to_assign'
          and (case when b.month > date_trunc('month',as_of)::date then least(b.opening_minor+b.allocated_minor,b.closing_minor) else b.closing_minor end) < least(coalesce((funding_before->>(b.envelope_id::text || ':' || b.month::text))::bigint,0),0)) then
        raise exception 'Allocation makes a projected source envelope unfunded'; end if;
      new_data := budgie_private.aggregate('allocation',id);
    when 'rebuild' then entity := 'budget'; id := p_budget;
    else raise exception 'Unsupported budget operation: %',op;
  end case;
  perform budgie_private.validate_budget(p_budget);
  perform budgie_private.replay(p_budget,coalesce(as_of,current_date));
  result := coalesce(result,jsonb_build_object('id',id,'version',new_data->>'version'));
  insert into public.audit_events (budget_id,actor_user_id,operation,entity_type,entity_id,before_data,after_data,request_id)
    values (p_budget,actor,op,entity,id,budgie_private.lossless_json(old_data),budgie_private.lossless_json(new_data),p_request);
  insert into public.write_requests (budget_id,request_id,actor_user_id,payload_hash,result) values (p_budget,p_request,actor,hash,result);
  return result;
end $$;

-- The supplied budget UUID also makes bootstrap retryable without a budget row
-- to lock first. The transaction-scoped advisory lock serializes that UUID only.
create function public.budgie_create_budget(p_budget uuid,p_request uuid,p_data jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid(); saved public.write_requests; ready uuid; result jsonb;
  hash text := encode(sha256(convert_to('create_budget:' || p_data::text,'UTF8')),'hex');
begin
  if actor is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if p_budget is null or p_request is null then raise exception 'Budget and request IDs required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_budget::text,0));
  if exists (select 1 from public.budgets where id = p_budget) then
    perform budgie_private.lock_budget(p_budget);
    select * into saved from public.write_requests where budget_id = p_budget and request_id = p_request;
    if not found or saved.actor_user_id <> actor or saved.payload_hash <> hash then raise exception 'Budget or request already exists'; end if;
    return saved.result;
  end if;
  insert into public.budgets (id,name,currency_code,minor_unit_scale) values (p_budget,p_data->>'name',p_data->>'currency_code',(p_data->>'minor_unit_scale')::smallint);
  insert into public.budget_owners (budget_id,user_id) values (p_budget,actor);
  insert into public.envelopes (budget_id,name,kind,sort_order) values (p_budget,'Ready to assign','ready_to_assign',0) returning id into ready;
  result := jsonb_build_object('id',p_budget,'ready_to_assign_id',ready);
  insert into public.write_requests (budget_id,request_id,actor_user_id,payload_hash,result) values (p_budget,p_request,actor,hash,result);
  insert into public.audit_events (budget_id,actor_user_id,operation,entity_type,entity_id,after_data,request_id)
    values (p_budget,actor,'budget_create','budget',p_budget,p_data || result,p_request),
      (p_budget,actor,'owner_add','owner',actor,jsonb_build_object('user_id',actor),p_request);
  perform budgie_private.replay(p_budget,current_date);
  return result;
end $$;

-- Safe aggregate boundary: all bigint values are decimal strings in JSON.
create function budgie_private.lossless_json(p_value jsonb) returns jsonb
language plpgsql stable set search_path = '' as $$
declare result jsonb; item record;
begin
  case jsonb_typeof(p_value)
    when 'object' then
      result := '{}';
      for item in select * from jsonb_each(p_value) loop
        result := result || jsonb_build_object(item.key,case when item.key like '%_minor' or item.key in ('sequence','version') then
          case when item.value = 'null'::jsonb then 'null'::jsonb else to_jsonb(item.value #>> '{}') end
          else budgie_private.lossless_json(item.value) end);
      end loop;
      return result;
    when 'array' then
      select coalesce(jsonb_agg(budgie_private.lossless_json(value)),'[]') into result from jsonb_array_elements(p_value);
      return result;
    else return p_value;
  end case;
end $$;

-- One invocation yields one MVCC snapshot. Read materializes requested empty
-- months under the same lock, then returns histories, totals, and explanations.
create function public.budgie_snapshot(p_budget uuid,p_month date,p_as_of date) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
    'effects',(select coalesce(jsonb_agg(to_jsonb(e)),'[]') from pg_temp.budgie_effects e),
    'deficits',(select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('remaining_minor',l.remaining,'eligible_minor',l.eligible,'direct_covered_minor',l.direct_covered) - 'remaining' - 'eligible' - 'direct_covered' order by ordinal),'[]') from pg_temp.budgie_lots l where remaining > 0)
  ) into result;
  return budgie_private.lossless_json(result);
end $$;

-- Default EXECUTE is PUBLIC even for privileged functions. Remove it explicitly.
revoke all on all functions in schema budgie_private from public,anon,authenticated;
grant execute on function budgie_private.is_owner(uuid) to authenticated;
revoke all on function public.budgie_command(uuid,uuid,jsonb) from public,anon;
revoke all on function public.budgie_create_budget(uuid,uuid,jsonb) from public,anon;
revoke all on function public.budgie_snapshot(uuid,date,date) from public,anon;
grant execute on function public.budgie_command(uuid,uuid,jsonb),public.budgie_create_budget(uuid,uuid,jsonb),public.budgie_snapshot(uuid,date,date) to authenticated;

create view public.budgie_scheduled_forecast with (security_invoker = true) as
select t.id,t.budget_id,t.kind,t.effective_date,t.payee_id,t.memo,t.sequence::text as sequence,t.version::text as version,
  (select jsonb_agg(jsonb_build_object('account_id',e.account_id,'amount_minor',e.amount_minor::text,'position',e.position) order by e.position)
    from public.account_entries e where e.transaction_id = t.id) as entries,
  (select coalesce(jsonb_agg(jsonb_build_object('envelope_id',s.envelope_id,'amount_minor',s.amount_minor::text,'position',s.position) order by s.position),'[]')
    from public.transaction_splits s where s.transaction_id = t.id) as splits
from public.transactions t where status = 'scheduled';
revoke all on public.budgie_scheduled_forecast from anon,authenticated;
grant select on public.budgie_scheduled_forecast to authenticated;

create function public.budgie_reconciliation_preview(p_budget uuid,p_account uuid,p_date date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare recorded bigint;
begin
  perform budgie_private.lock_budget(p_budget);
  if p_date is null or not exists (select 1 from public.accounts where budget_id = p_budget and id = p_account and archived_at is null) then
    raise exception 'Active budget account and selected financial date required'; end if;
  select coalesce(sum(e.amount_minor),0) into recorded from public.account_entries e join public.transactions t on t.id = e.transaction_id
    where e.budget_id = p_budget and e.account_id = p_account and t.status = 'posted' and t.effective_date <= p_date;
  return jsonb_build_object('account_id',p_account,'effective_date',p_date,'recorded_minor',recorded::text);
end $$;
revoke all on function public.budgie_reconciliation_preview(uuid,uuid,date) from public,anon;
grant execute on function public.budgie_reconciliation_preview(uuid,uuid,date) to authenticated;
