CREATE OR REPLACE FUNCTION budgie_private.validate_transaction (
  p_id uuid
)
  RETURNS void
  LANGUAGE plpgsql
  SET search_path TO ''
  AS $function$
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
end $function$;

REVOKE ALL ON FUNCTION "budgie_private"."validate_transaction"(uuid) FROM PUBLIC;
