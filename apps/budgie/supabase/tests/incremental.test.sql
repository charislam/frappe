begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
set client_min_messages = warning;
create function pg_temp.id(label text) returns uuid language sql immutable as $$ select md5('incremental:' || label)::uuid $$;
insert into auth.users(id) values(pg_temp.id('owner')),(pg_temp.id('outsider'));
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
create function pg_temp.cmd(op text,data jsonb default '{}',options jsonb default '{}') returns jsonb language sql as $$
  select public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation',op,'data',data) || options) $$;
create function pg_temp.state() returns jsonb language sql as $$
  select jsonb_build_array(
    (select jsonb_agg(to_jsonb(b) order by account_id) from public.account_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month,envelope_id) from public.envelope_month_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by ordinal) from public.deficit_lots b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month) from public.replay_checkpoints b where budget_id = pg_temp.id('budget'))) $$;
-- Reference calculation deliberately sums authoritative entries rather than checkpoints.
create function pg_temp.expected_overview(p_month date) returns jsonb language sql as $$
  with period_accounts as (
    select a.id,a.budget_id,a.kind,coalesce(sum(e.amount_minor) filter (where t.status = 'posted' and t.effective_date < (p_month + interval '1 month')::date),0)::bigint as balance_minor
    from public.accounts a left join public.account_entries e on e.account_id = a.id
      left join public.transactions t on t.id = e.transaction_id
    where a.budget_id = pg_temp.id('budget') group by a.id
  )
  select budgie_private.lossless_json(jsonb_build_object(
      'cash_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = pg_temp.id('budget') and a.kind = 'cash'),
      'investment_minor',(select coalesce(sum(balance_minor),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = pg_temp.id('budget') and a.kind = 'investment'),
      'credit_debt_minor',(select coalesce(sum(greatest(-balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = pg_temp.id('budget') and a.kind = 'credit'),
      'positive_credit_minor',(select coalesce(sum(greatest(balance_minor,0)),0) from period_accounts b join public.accounts a on a.id = b.id where b.budget_id = pg_temp.id('budget') and a.kind = 'credit'),
      'negative_payment_reserve_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = pg_temp.id('budget') and b.month = p_month and e.kind = 'credit_payment'),
      'negative_spending_minor',(select coalesce(sum(least(closing_minor,0)),0) from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where b.budget_id = pg_temp.id('budget') and b.month = p_month and e.kind = 'regular'),
      'uncovered_debt_minor',(select coalesce(sum(greatest(-a.balance_minor-greatest(e.closing_minor,0),0)),0) from period_accounts a
        join public.envelopes p on p.credit_account_id = a.id join public.envelope_month_balances e on e.envelope_id = p.id and e.month = p_month where a.budget_id = pg_temp.id('budget'))
  )) $$;
create function pg_temp.equivalent(label text) returns text language plpgsql as $$
declare previous jsonb := pg_temp.state(); point record;
begin
  -- Check snapshots before rebuilding, so a rebuild cannot hide a stale checkpoint.
  for point in select month from public.replay_checkpoints where budget_id = pg_temp.id('budget') order by month loop
    if public.budgie_snapshot(pg_temp.id('budget'),point.month,'UTC')->'overview'
        is distinct from pg_temp.expected_overview(point.month) then
      raise exception 'Checkpoint overview differs from transaction history after % in %',label,point.month;
    end if;
  end loop;
  perform budgie_private.replay(pg_temp.id('budget'),(select max(month) from public.envelope_month_balances where budget_id = pg_temp.id('budget')));
  return is(pg_temp.state(),previous,label || ' matches a full rebuild, including checkpoints');
end $$;
create function pg_temp.physical(before_month date default 'infinity') returns jsonb language sql as $$
  select jsonb_build_array(
    (select jsonb_agg(jsonb_build_array(envelope_id,month,ctid::text) order by month,envelope_id) from public.envelope_month_balances where budget_id = pg_temp.id('budget') and month < before_month),
    (select jsonb_agg(jsonb_build_array(month,ctid::text) order by month) from public.replay_checkpoints where budget_id = pg_temp.id('budget') and month < before_month)) $$;
create function pg_temp.tx(label text,options jsonb) returns jsonb language sql as $$
  select pg_temp.cmd('transaction_save',jsonb_build_object('kind',options->>'kind','status',coalesce(options->>'status','posted'),
    'effective_date',options->>'day','memo',options->>'memo',
    'entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id(options->>'account'),'amount_minor',options->>'amount')),
    'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id(options->>'envelope'),'amount_minor',options->>'amount'))),
    jsonb_build_object('id',pg_temp.id(label),'expected_version',options->>'version')) $$;
select public.budgie_create_budget(pg_temp.id('budget'),gen_random_uuid(),'{"name":"Incremental","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}');
select is(public.budgie_snapshot(pg_temp.id('budget'),date_trunc('month',current_date)::date,'UTC')->'overview',
  pg_temp.expected_overview(date_trunc('month',current_date)::date),'Bootstrap creates a usable empty checkpoint before the first snapshot');
select pg_temp.cmd('account_create','{"name":"Cash","kind":"cash"}',jsonb_build_object('id',pg_temp.id('cash')));
select pg_temp.cmd('account_create','{"name":"Card","kind":"credit"}',jsonb_build_object('id',pg_temp.id('card')));
select pg_temp.cmd('envelope_create','{"name":"Food"}',jsonb_build_object('id',pg_temp.id('food')));
select pg_temp.equivalent('New dimensions');
select pg_temp.tx('income',jsonb_build_object('kind','income','account','cash','amount',10000,'envelope','food','day','2026-01-02'));
select pg_temp.equivalent('First backdated activity');
create temp table captured as select pg_temp.physical('2026-02-01') state;
select pg_temp.tx('purchase',jsonb_build_object('kind','expense','account','card','amount',-12000,'envelope','food','day','2026-02-03'));
select is(pg_temp.physical('2026-02-01'),(select state from captured),'Safe append preserves earlier month rows and checkpoints');
select pg_temp.equivalent('Append with partly unfunded credit purchase');
truncate captured; insert into captured select pg_temp.physical();
select public.budgie_snapshot(pg_temp.id('budget'),'2026-02-01','UTC');
select pg_temp.cmd('budget_update','{"name":"Renamed"}');
select pg_temp.tx('purchase',jsonb_build_object('kind','expense','account','card','amount',-12000,'envelope','food','day','2026-02-03','status','posted','version',1,'memo','New memo'));
select pg_temp.tx('schedule',jsonb_build_object('kind','expense','account','card','amount',-100,'envelope','food','day','2026-02-03','status','scheduled'));
select is(pg_temp.physical(),(select state from captured),'Read, metadata edit, memo edit, and schedule do not rewrite projection rows');
select pg_temp.equivalent('Metadata and scheduled activity');
truncate captured; insert into captured select pg_temp.physical('2026-02-01');
select pg_temp.tx('purchase',jsonb_build_object('kind','expense','account','card','amount',-13000,'envelope','food','day','2026-02-05','status','posted','version',2));
select is(pg_temp.physical('2026-02-01'),(select state from captured),'Correction restores checkpoint and preserves unaffected prefix');
select pg_temp.equivalent('Backdated amount and date correction');
select pg_temp.cmd('transaction_post','{}',jsonb_build_object('id',pg_temp.id('schedule'),'expected_version',1));
select pg_temp.equivalent('Posting an older schedule reorders same-day activity');
select pg_temp.tx('cover',jsonb_build_object('kind','income','account','cash','amount',4000,'envelope','food','day','2026-03-01'));
select pg_temp.equivalent('Append covers outstanding credit deficit');
select pg_temp.tx('cash deficit',jsonb_build_object('kind','expense','account','cash','amount',-2000,'envelope','food','day','2026-04-01'));
select pg_temp.equivalent('New lot ordinal after earlier lots settle');
select pg_temp.tx('cash cover',jsonb_build_object('kind','income','account','cash','amount',3000,'envelope','food','day','2026-04-02'));
select pg_temp.equivalent('Cash deficit settlement');
select pg_temp.tx('income',jsonb_build_object('kind','income','account','cash','amount',10000,'envelope','food','day','2026-05-01','status','posted','version',1));
select pg_temp.equivalent('Moving activity forward invalidates from its old date');
select pg_temp.cmd('transaction_void','{}',jsonb_build_object('id',pg_temp.id('purchase'),'expected_version',3));
select pg_temp.equivalent('Voiding a historical purchase');
select pg_temp.cmd('account_create','{"name":"Later cash","kind":"cash"}',jsonb_build_object('id',pg_temp.id('later cash')));
select pg_temp.cmd('envelope_create','{"name":"Later envelope"}',jsonb_build_object('id',pg_temp.id('later envelope')));
select pg_temp.equivalent('Dimensions added after history seed old checkpoints');
select public.budgie_snapshot(pg_temp.id('budget'),'2027-03-01','UTC');
select public.budgie_snapshot(pg_temp.id('budget'),'2025-11-01','UTC');
select pg_temp.equivalent('Read extends both past and future empty months');
-- Future allocations make an otherwise latest transaction unsafe to append.
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-08-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','-100'),
  jsonb_build_object('envelope_id',pg_temp.id('later envelope'),'amount_minor','100'))));
select pg_temp.tx('future funding',jsonb_build_object('kind','income','account','cash','amount',500,'envelope','food','day','2026-06-01'));
select ok(not budgie_private.can_append(pg_temp.id('future funding')),'A future allocation excludes the append fast path');
select pg_temp.equivalent('Transaction preceding future allocation');
select pg_temp.tx('same-day schedule',jsonb_build_object('kind','expense','account','card','amount',-10,'envelope','food','day','2026-09-01','status','scheduled'));
select pg_temp.tx('same-day posted',jsonb_build_object('kind','expense','account','card','amount',-20,'envelope','food','day','2026-09-01'));
select pg_temp.cmd('transaction_post','{}',jsonb_build_object('id',pg_temp.id('same-day schedule'),'expected_version',1));
select ok(not budgie_private.can_append(pg_temp.id('same-day schedule')),'An older same-day sequence excludes the append fast path');
select pg_temp.equivalent('Stable same-day ordering when posting an older schedule');
truncate captured; insert into captured select pg_temp.physical();
select pg_temp.cmd('transaction_post','{}',jsonb_build_object('id',pg_temp.id('same-day schedule'),'expected_version',2));
select pg_temp.tx('void schedule',jsonb_build_object('kind','expense','account','card','amount',-10,'envelope','food','day','2026-09-01','status','scheduled'));
select pg_temp.cmd('transaction_void','{}',jsonb_build_object('id',pg_temp.id('void schedule'),'expected_version',1));
select pg_temp.cmd('reconcile',jsonb_build_object('account_id',pg_temp.id('cash'),'effective_date','2026-12-31',
  'expected_recorded_minor',(select balance_minor::text from public.account_balances where account_id = pg_temp.id('cash')),
  'observed_minor',(select balance_minor::text from public.account_balances where account_id = pg_temp.id('cash'))));
select is(pg_temp.physical(),(select state from captured),'Repeated posting, scheduled void, and zero reconciliation preserve caches');
select pg_temp.tx('cover',jsonb_build_object('kind','income','account','cash','amount',4000,'envelope','food','day','2026-01-01','version',1));
select pg_temp.equivalent('Moving activity backward invalidates from its new date');
create function pg_temp.allocation(label text,options jsonb) returns jsonb language sql as $$
  select pg_temp.cmd('allocation_save',jsonb_build_object('month',options->>'month','entries',jsonb_build_array(
    jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor',(-(options->>'amount')::bigint)::text),
    jsonb_build_object('envelope_id',pg_temp.id('later envelope'),'amount_minor',options->>'amount'))),
    jsonb_build_object('id',pg_temp.id(label),'expected_version',options->>'version')) $$;
truncate captured; insert into captured select pg_temp.physical('2026-07-01');
select pg_temp.allocation('checkpoint allocation','{"month":"2026-07-01","amount":"1000"}');
select is(pg_temp.physical('2026-07-01'),(select state from captured),'New allocation preserves canonical prefix');
select pg_temp.equivalent('Allocation creation from a canonical checkpoint');
truncate captured; insert into captured select pg_temp.physical('2026-07-01');
select pg_temp.allocation('checkpoint allocation','{"month":"2026-07-01","amount":"2000","version":1}');
select is(pg_temp.physical('2026-07-01'),(select state from captured),'Allocation amount edit preserves unaffected prefix');
select pg_temp.equivalent('Allocation amount correction');
truncate captured; insert into captured select pg_temp.physical('2026-07-01');
select pg_temp.allocation('checkpoint allocation','{"month":"2026-10-01","amount":"2000","version":2}');
select is(pg_temp.physical('2026-07-01'),(select state from captured),'Moving allocation forward preserves months before its old month');
select pg_temp.equivalent('Moving allocation forward replays from its old month');
truncate captured; insert into captured select pg_temp.physical('2026-03-01');
select pg_temp.allocation('checkpoint allocation','{"month":"2026-03-01","amount":"1500","version":3}');
select is(pg_temp.physical('2026-03-01'),(select state from captured),'Moving allocation backward preserves months before its new month');
select pg_temp.equivalent('Moving allocation backward replays from its new month');
truncate captured; insert into captured select pg_temp.physical('2026-03-01');
select pg_temp.cmd('allocation_void','{}',jsonb_build_object('id',pg_temp.id('checkpoint allocation'),'expected_version',4));
select is(pg_temp.physical('2026-03-01'),(select state from captured),'Allocation void preserves unaffected canonical prefix');
select pg_temp.equivalent('Historical allocation void');
truncate captured; insert into captured select pg_temp.physical('2026-07-01');
select pg_temp.allocation('unfunded allocation','{"month":"2026-07-01","amount":"50000"}');
select ok((select closing_minor from public.envelope_month_balances where envelope_id = pg_temp.id('food') and month = '2026-07-01') < 0,
  'Allocation may make its source envelope negative');
select is(pg_temp.physical('2026-07-01'),(select state from captured),'Unfunded allocation preserves unaffected checkpoints');
select pg_temp.equivalent('Unfunded allocation');
select pg_temp.allocation('unfunded allocation','{"month":"2026-07-01","amount":"60000","version":1}');
select ok((select closing_minor from public.envelope_month_balances where envelope_id = pg_temp.id('food') and month = '2026-07-01') < -40000,
  'Allocation edit may worsen an existing source-envelope shortage');
select pg_temp.equivalent('Increasing an unfunded allocation');
select pg_temp.cmd('allocation_void','{}',jsonb_build_object('id',pg_temp.id('unfunded allocation'),'expected_version',2));
select pg_temp.equivalent('Voiding an unfunded allocation');
-- Removing an earlier assignment may expose a shortage in a later source envelope.
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-09-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where budget_id = pg_temp.id('budget') and kind = 'ready_to_assign'),'amount_minor','-1000'),
  jsonb_build_object('envelope_id',pg_temp.id('later envelope'),'amount_minor','1000'))),jsonb_build_object('id',pg_temp.id('source allocation')));
select is(budgie_private.ready_available(pg_temp.id('budget'),'2026-01-01'),-1000::bigint,'Future assignment exposes negative Ready to assign immediately');
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-10-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',pg_temp.id('later envelope'),'amount_minor','-1100'),
  jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','1100'))),jsonb_build_object('id',pg_temp.id('dependent allocation')));
select pg_temp.cmd('allocation_void','{}',jsonb_build_object('id',pg_temp.id('source allocation'),'expected_version',1));
select is((select closing_minor from public.envelope_month_balances where envelope_id = pg_temp.id('later envelope') and month = '2026-10-01'),
  -1000::bigint,'Voiding an earlier assignment may expose a later source-envelope shortage');
select pg_temp.equivalent('Voiding an assignment supporting a later transfer');
-- No checkpoint exists before this newly materialized month: fall back to zero.
select pg_temp.tx('early funding',jsonb_build_object('kind','income','account','cash','amount',10,'envelope','food','day','2025-10-02'));
select ok(not exists(select 1 from public.replay_checkpoints where budget_id = pg_temp.id('budget') and month < '2025-10-01'),
  'Earliest allocation has no unaffected checkpoint');
select pg_temp.allocation('early allocation','{"month":"2025-10-01","amount":"10"}');
select pg_temp.equivalent('Allocation before the first checkpoint falls back to full rebuild');
-- Broken cache invariants must not silently produce an all-zero overview.
create temp table missing_checkpoint as select * from public.replay_checkpoints
  where budget_id = pg_temp.id('budget') and month = '2026-03-01';
delete from public.replay_checkpoints where budget_id = pg_temp.id('budget') and month = '2026-03-01';
select throws_ok($$select public.budgie_snapshot(pg_temp.id('budget'),'2026-03-01','UTC')$$,
  'P0002','query returned no rows','A missing in-range checkpoint fails instead of inventing zero balances');
insert into public.replay_checkpoints select * from missing_checkpoint;
-- Checkpoint state is private calculation input: owners read, clients cannot alter it.
set local role authenticated;
select ok(exists(select 1 from public.replay_checkpoints where budget_id = pg_temp.id('budget')),'Owner can read own checkpoints');
select throws_ok($$delete from public.replay_checkpoints$$,'42501',null,'Clients cannot mutate checkpoints');
select set_config('request.jwt.claim.sub',pg_temp.id('outsider')::text,true);
select is((select count(*) from public.replay_checkpoints),0::bigint,'Other owners cannot read checkpoint state');
reset role;
select * from finish();
rollback;
