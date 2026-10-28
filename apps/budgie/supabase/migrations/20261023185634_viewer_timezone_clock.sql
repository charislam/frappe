SET local check_function_bodies = off;

DROP FUNCTION "public"."budgie_snapshot"(uuid, date, date);

CREATE OR REPLACE FUNCTION budgie_private.local_date (
  p_time_zone text,
  p_instant   timestamp with time zone DEFAULT CURRENT_TIMESTAMP
)
  RETURNS date
  LANGUAGE plpgsql
  STABLE
  SET search_path TO ''
  AS $function$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = p_time_zone) then
    raise exception 'Valid viewer time zone required';
  end if;
  return (p_instant at time zone p_time_zone)::date;
end $function$;

CREATE OR REPLACE FUNCTION budgie_private.recalculate (
  p_budget  uuid,
  p_options jsonb
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare
  through_date date := coalesce((p_options->>'through')::date,current_date);
  requested_start date := (p_options->>'from_month')::date;
  point public.replay_checkpoints; resume boolean := false;
  month_start date; last_month date; cached_through date; cached_first date; event record;
begin
  select min(month),max(month) into cached_first,cached_through from public.envelope_month_balances where budget_id = p_budget;
  if requested_start is not null then
    select * into point from public.replay_checkpoints where budget_id = p_budget and month < date_trunc('month',requested_start)::date order by month desc limit 1;
    resume := found;
  end if;
  select least(date_trunc('month',through_date)::date,cached_first,
    coalesce((select min(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted'),through_date),
    coalesce((select min(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),through_date)) into month_start;
  month_start := date_trunc('month',month_start)::date;
  select greatest(cached_through,date_trunc('month',through_date)::date,
    (select max(month) from public.allocation_batches where budget_id = p_budget and voided_at is null),
    (select max(date_trunc('month',effective_date)::date) from public.transactions where budget_id = p_budget and status = 'posted')) into last_month;
  -- The caller holds the budget lock; all intermediate state remains uncommitted.
  delete from public.deficit_lots where budget_id = p_budget;
  delete from public.account_balances where budget_id = p_budget;
  insert into public.account_balances (budget_id,account_id,balance_minor) select p_budget,id,0 from public.accounts where budget_id = p_budget;
  if resume then
    month_start := (point.month+interval '1 month')::date;
    update public.account_balances b set balance_minor = s.balance_minor
      from jsonb_to_recordset(point.account_balances) s(account_id uuid,balance_minor bigint)
      where b.budget_id = p_budget and b.account_id = s.account_id;
    insert into public.deficit_lots (budget_id,ordinal,transaction_id,position,envelope_id,card_id,remaining_minor,eligible_minor,direct_covered_minor)
      select p_budget,s.ordinal,s.transaction_id,s.position,s.envelope_id,s.card_id,s.remaining_minor,s.eligible_minor,s.direct_covered_minor
      from jsonb_to_recordset(point.deficit_lots) s(ordinal bigint,transaction_id uuid,position integer,envelope_id uuid,card_id uuid,remaining_minor bigint,eligible_minor bigint,direct_covered_minor bigint);
    delete from public.envelope_month_balances where budget_id = p_budget and month >= month_start;
    delete from public.replay_checkpoints where budget_id = p_budget and month >= month_start;
  else
    delete from public.envelope_month_balances where budget_id = p_budget;
    delete from public.replay_checkpoints where budget_id = p_budget;
  end if;
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
        where budget_id = p_budget and status = 'posted' and effective_date >= month_start and effective_date < (month_start+interval '1 month')::date
      order by day,priority,sequence
    loop
      case event.priority
        when 0 then perform budgie_private.apply_allocation(event.id);
        when 1 then perform budgie_private.apply_transaction(event.id);
      end case;
    end loop;
    perform budgie_private.save_checkpoint(p_budget,month_start);
    month_start := (month_start+interval '1 month')::date;
  end loop;
end $function$;

CREATE OR REPLACE FUNCTION public.budgie_command (
  p_budget  uuid,
  p_request uuid,
  p_command jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
#variable_conflict use_variable
declare
  actor uuid; op text := p_command->>'operation'; data jsonb := coalesce(p_command->'data','{}');
  id uuid := coalesce((p_command->>'id')::uuid,gen_random_uuid());
  today date; old_data jsonb; new_data jsonb; result jsonb;
  saved public.write_requests; expected bigint := (p_command->>'expected_version')::bigint;
  hash text := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  line jsonb; item record; entity text; month date;
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
      today := budgie_private.local_date(p_command->>'time_zone');
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
          if op = 'transaction_post' and (old_data->>'effective_date')::date > today then raise exception 'Schedule is not due'; end if;
          if op = 'transaction_post' and old_data->>'status' = 'scheduled' and (
            exists (select 1 from public.account_entries e join public.accounts a on a.id = e.account_id where e.transaction_id = id and a.archived_at is not null)
            or exists (select 1 from public.transaction_splits s join public.envelopes e on e.id = s.envelope_id left join public.envelope_groups g on g.id = e.group_id where s.transaction_id = id and (e.archived_at is not null or g.archived_at is not null))
            or exists (select 1 from public.payees p where p.id = (old_data->>'payee_id')::uuid and p.archived_at is not null)
          ) then raise exception 'Cannot post schedule with archived entities'; end if;
          if (op = 'transaction_post' and old_data->>'status' <> 'posted') or (op = 'transaction_void' and old_data->>'status' <> 'voided') then
            update public.transactions t set status = case op when 'transaction_post' then 'posted' else 'voided' end, version = version+1,updated_at = now() where t.id = id;
          end if;
        else
          if coalesce(data->>'status','posted') = 'posted' and (data->>'effective_date')::date > today then raise exception 'Cannot post future activity'; end if;
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
      today := budgie_private.local_date(p_command->>'time_zone');
      old_data := budgie_private.aggregate('allocation',id);
      if old_data is not null and (old_data->>'budget_id')::uuid <> p_budget then raise exception 'Allocation not found'; end if;
      if old_data is not null and expected is distinct from (old_data->>'version')::bigint then raise exception 'Stale allocation version' using errcode = '40001'; end if;
      month := coalesce((data->>'month')::date,(old_data->>'month')::date);
      if month is null or extract(day from month) <> 1 then raise exception 'Allocation month must be first day'; end if;
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
      new_data := budgie_private.aggregate('allocation',id);
    when 'rebuild' then
      today := budgie_private.local_date(p_command->>'time_zone');
      entity := 'budget'; id := p_budget;
    else raise exception 'Unsupported budget operation: %',op;
  end case;
  perform budgie_private.validate_budget(p_budget);
  if op = 'rebuild' then
    perform budgie_private.replay(p_budget,today);
  elsif entity = 'allocation' then
    -- Recalculate only the affected allocation timeline; negative balances remain visible.
    perform budgie_private.recalculate(p_budget,jsonb_build_object('through',greatest(today,month),
      'from_month',least(month,(old_data->>'month')::date)));
  elsif entity = 'transaction'
      and budgie_private.financial_shape(old_data) is distinct from budgie_private.financial_shape(new_data)
      and (old_data->>'status' = 'posted' or new_data->>'status' = 'posted') then
    if new_data->>'status' = 'posted' and coalesce(old_data->>'status','') <> 'posted'
        and budgie_private.can_append(id) then
      perform budgie_private.ensure_months(p_budget,today);
      perform budgie_private.append_transaction(id);
    else
      perform budgie_private.recalculate(p_budget,jsonb_build_object('through',today,
        'from_month',least(case when old_data->>'status' = 'posted' then (old_data->>'effective_date')::date end,
                          case when new_data->>'status' = 'posted' then (new_data->>'effective_date')::date end)));
    end if;
  elsif op in ('account_create','envelope_create') then
    perform budgie_private.seed_dimensions(p_budget);
  end if;
  result := coalesce(result,jsonb_build_object('id',id,'version',new_data->>'version'));
  insert into public.audit_events (budget_id,actor_user_id,operation,entity_type,entity_id,before_data,after_data,request_id)
    values (p_budget,actor,op,entity,id,budgie_private.lossless_json(old_data),budgie_private.lossless_json(new_data),p_request);
  insert into public.write_requests (budget_id,request_id,actor_user_id,payload_hash,result) values (p_budget,p_request,actor,hash,result);
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.budgie_create_budget (
  p_budget  uuid,
  p_request uuid,
  p_data    jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
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
  perform budgie_private.replay(p_budget,budgie_private.local_date(p_data->>'time_zone'));
  return result;
end $function$;

CREATE OR REPLACE FUNCTION public.budgie_snapshot (
  p_budget    uuid,
  p_month     date,
  p_time_zone text
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
declare result jsonb; today date;
begin
  perform budgie_private.lock_budget(p_budget);
  if p_month is null or extract(day from p_month) <> 1 then raise exception 'First day of month required'; end if;
  today := budgie_private.local_date(p_time_zone);
  perform budgie_private.ensure_months(p_budget,greatest(p_month,today));
  perform budgie_private.ensure_months(p_budget,p_month);
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

REVOKE ALL ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) FROM PUBLIC, "anon";

REVOKE ALL ON FUNCTION "budgie_private"."local_date"(text, timestamp WITH time zone) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "authenticated";

REVOKE ALL ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."budgie_snapshot"(uuid, date, text) TO "service_role";
