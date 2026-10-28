SET local check_function_bodies = off;

CREATE OR REPLACE FUNCTION budgie_private.project_funding (
  p_budget  uuid,
  p_options jsonb
)
  RETURNS jsonb
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
declare projection jsonb; cutoff date := (p_options->>'cutoff')::date;
begin
  perform budgie_private.replay(p_budget,(p_options->>'through')::date,cutoff);
  select jsonb_build_object('ready_minor',budgie_private.ready_available(p_budget,cutoff),
    'envelopes',coalesce(jsonb_object_agg(b.envelope_id::text || ':' || b.month::text,
      case when b.month > date_trunc('month',cutoff)::date then least(b.opening_minor+b.allocated_minor,b.closing_minor) else b.closing_minor end),'{}'))
    into projection from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id
    where b.budget_id = p_budget and e.kind <> 'ready_to_assign';
  -- PL/pgSQL exception blocks roll back database writes but retain local values.
  -- Catch only this private sentinel; real calculation failures propagate.
  raise exception using errcode = 'BGP01',message = 'Roll back funding projection';
exception when sqlstate 'BGP01' then
  return projection;
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
  as_of date := (p_command->>'as_of')::date; old_data jsonb; new_data jsonb; result jsonb;
  saved public.write_requests; expected bigint := (p_command->>'expected_version')::bigint;
  hash text := encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  line jsonb; item record; entity text; month date; ready_before bigint; funding_before jsonb; projection jsonb;
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
      projection := budgie_private.project_funding(p_budget,jsonb_build_object('through',greatest(as_of,month),'cutoff',as_of));
      ready_before := (projection->>'ready_minor')::bigint;
      funding_before := projection->'envelopes';
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
      projection := budgie_private.project_funding(p_budget,jsonb_build_object('through',greatest(as_of,month),'cutoff',as_of));
      if (projection->>'ready_minor')::bigint < least(ready_before,0) then raise exception 'Allocation exceeds available money'; end if;
      if exists (select 1 from jsonb_each_text(projection->'envelopes') b
        where b.value::bigint < least(coalesce((funding_before->>b.key)::bigint,0),0)) then
        raise exception 'Allocation makes a projected source envelope unfunded'; end if;
      new_data := budgie_private.aggregate('allocation',id);
    when 'rebuild' then entity := 'budget'; id := p_budget;
    else raise exception 'Unsupported budget operation: %',op;
  end case;
  perform budgie_private.validate_budget(p_budget);
  if op = 'rebuild' then
    perform budgie_private.replay(p_budget,coalesce(as_of,current_date));
  elsif entity = 'allocation' then
    -- Funding projections rolled back; the unaffected canonical prefix survives.
    perform budgie_private.recalculate(p_budget,jsonb_build_object('through',greatest(as_of,month),
      'from_month',least(month,(old_data->>'month')::date)));
  elsif entity = 'transaction'
      and budgie_private.financial_shape(old_data) is distinct from budgie_private.financial_shape(new_data)
      and (old_data->>'status' = 'posted' or new_data->>'status' = 'posted') then
    if new_data->>'status' = 'posted' and coalesce(old_data->>'status','') <> 'posted'
        and budgie_private.can_append(id) then
      perform budgie_private.ensure_months(p_budget,greatest(as_of,current_date));
      perform budgie_private.append_transaction(id);
    else
      perform budgie_private.recalculate(p_budget,jsonb_build_object('through',coalesce(as_of,current_date),
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

REVOKE ALL ON FUNCTION "budgie_private"."project_funding"(uuid, jsonb) FROM PUBLIC;
