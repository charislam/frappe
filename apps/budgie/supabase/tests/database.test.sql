-- Run with `supabase test db`. All fixtures roll back; no real identities remain.
begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
set client_min_messages = warning;

create function pg_temp.id(label text) returns uuid language sql immutable as $$ select md5(label)::uuid $$;
insert into auth.users (id) values (pg_temp.id('owner')), (pg_temp.id('other owner')), (pg_temp.id('outsider'));
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
create function pg_temp.verify_projection(result jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare previous jsonb; rebuilt jsonb; horizon date;
begin
  select jsonb_build_array(
    (select jsonb_agg(to_jsonb(b) order by account_id) from public.account_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month,envelope_id) from public.envelope_month_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by ordinal) from public.deficit_lots b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month) from public.replay_checkpoints b where budget_id = pg_temp.id('budget'))) into previous;
  select max(month) into horizon from public.envelope_month_balances where budget_id = pg_temp.id('budget');
  perform budgie_private.replay(pg_temp.id('budget'),horizon);
  select jsonb_build_array(
    (select jsonb_agg(to_jsonb(b) order by account_id) from public.account_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month,envelope_id) from public.envelope_month_balances b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by ordinal) from public.deficit_lots b where budget_id = pg_temp.id('budget')),
    (select jsonb_agg(to_jsonb(b) order by month) from public.replay_checkpoints b where budget_id = pg_temp.id('budget'))) into rebuilt;
  if previous is distinct from rebuilt then raise exception 'Incremental projection differs from reference rebuild after %',result; end if;
  return result;
end $$;
set local role authenticated;

create function pg_temp.cmd(op text,data jsonb default '{}',options jsonb default '{}') returns jsonb
language sql as $$ select pg_temp.verify_projection(public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation',op,'data',data) || options)) $$;
create function pg_temp.account(label text,kind text default 'cash') returns jsonb language sql as $$
  select pg_temp.cmd('account_create',jsonb_build_object('name',label,'kind',kind),jsonb_build_object('id',pg_temp.id(label))) $$;
create function pg_temp.envelope(label text) returns jsonb language sql as $$
  select pg_temp.cmd('envelope_create',jsonb_build_object('name',label),jsonb_build_object('id',pg_temp.id(label))) $$;
create function pg_temp.tx(data jsonb,options jsonb default '{}') returns jsonb language sql as $$ select pg_temp.cmd('transaction_save',data,options) $$;
create function pg_temp.activity(kind text,account text,amount bigint,envelope text,day date default '2026-10-02') returns jsonb language sql as $$
  select pg_temp.tx(jsonb_build_object('kind',kind,'effective_date',day,'entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id(account),'amount_minor',amount::text)),
  'splits',case when envelope is null then '[]'::jsonb else jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id(envelope),'amount_minor',amount::text)) end)) $$;
create function pg_temp.allocate(envelope text,amount bigint,month date default '2026-10-01') returns jsonb language sql as $$
  select pg_temp.cmd('allocation_save',jsonb_build_object('month',month,'entries',jsonb_build_array(
    jsonb_build_object('envelope_id',(select id from public.envelopes where budget_id = pg_temp.id('budget') and kind = 'ready_to_assign'),'amount_minor',(-amount)::text),
    jsonb_build_object('envelope_id',pg_temp.id(envelope),'amount_minor',amount::text)))) $$;
create function pg_temp.balance(label text,month date default '2026-10-01') returns bigint language sql as $$
  select closing_minor from public.envelope_month_balances where envelope_id = pg_temp.id(label) and envelope_month_balances.month = balance.month $$;
create function pg_temp.reserve(label text) returns bigint language sql as $$
  select b.closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id(label) and b.month = '2026-10-01' $$;
create function pg_temp.payment(card text,amount bigint,day date default '2026-10-10') returns jsonb language sql as $$
  select pg_temp.tx(jsonb_build_object('kind','transfer','effective_date',day,'entries',jsonb_build_array(
    jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor',(-amount)::text),
    jsonb_build_object('account_id',pg_temp.id(card),'amount_minor',amount::text)),'splits','[]'::jsonb)) $$;
create function pg_temp.rejected(command jsonb) returns boolean language plpgsql as $$ begin
  perform public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),command); return false;
exception when others then return true; end $$;

select is((public.budgie_create_budget(pg_temp.id('budget'),pg_temp.id('bootstrap'),'{"name":"Household","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}')->>'id')::uuid,pg_temp.id('budget'),'bootstrap creates a budget atomically');
select is((public.budgie_create_budget(pg_temp.id('budget'),pg_temp.id('bootstrap'),'{"name":"Household","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}')->>'id')::uuid,pg_temp.id('budget'),'bootstrap retry returns existing result');
select is((select count(*) from public.budget_owners),1::bigint,'bootstrap adds first owner');
select pg_temp.account('cash');
select pg_temp.account('savings');
select pg_temp.account('card A','credit');
select pg_temp.account('card B','credit');
select pg_temp.account('investment','investment');
select pg_temp.envelope('groceries');
select pg_temp.envelope('travel');
select pg_temp.envelope('mixed');
select pg_temp.envelope('paid deficit');
select pg_temp.envelope('direct debt');
select pg_temp.envelope('overpayment');
select pg_temp.envelope('refund deficit');
select pg_temp.envelope('investment funds');
select is((select count(*) from public.envelopes where kind = 'credit_payment'),2::bigint,'credit accounts create one reserve each');
-- Cash opening uses the generated system envelope.
select pg_temp.tx(jsonb_build_object('kind','opening_balance','effective_date','2026-10-01','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','10000')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','10000'))));
select pg_temp.allocate('groceries',50);
select pg_temp.activity('expense','card A',-80,'groceries');
select is(pg_temp.balance('groceries'),-30::bigint,'50 funded / 80 purchase leaves -30 groceries');
select is(pg_temp.reserve('card A'),50::bigint,'only funded credit spending becomes reserved');
-- Monthly funding convention: a later-month allocation repairs the existing lot.
select pg_temp.allocate('groceries',100,'2026-11-01');
select is(pg_temp.balance('groceries','2026-11-01'),70::bigint,'100 funding repairs 30 and leaves 70 spendable');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id('card A') and month = '2026-11-01'),80::bigint,'later deficit funding reserves only remaining 30');
select pg_temp.activity('expense','cash',-20,'mixed','2026-10-03');
select pg_temp.activity('expense','card A',-30,'mixed','2026-10-03');
select pg_temp.activity('expense','card B',-40,'mixed','2026-10-03');
select pg_temp.allocate('mixed',60,'2026-11-01');
select is(pg_temp.balance('mixed','2026-11-01'),-30::bigint,'mixed deficits retain uncovered balance');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id('card A') and month = '2026-11-01'),110::bigint,'cash lot consumed first, then card A by stable sequence');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id('card B') and month = '2026-11-01'),10::bigint,'only remaining ten funds card B');
select pg_temp.activity('expense','card B',-50,'paid deficit','2026-10-04');
select pg_temp.payment('card B',90);
select pg_temp.allocate('paid deficit',50,'2026-11-01');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id('card B') and month = '2026-11-01'),-90::bigint,'paid debt does not generate a reserve when its spending deficit is later covered');
select pg_temp.activity('refund','card B',20,'travel','2026-10-12');
select is(pg_temp.balance('travel'),20::bigint,'independent refund restores selected envelope');
select is(pg_temp.reserve('card B'),-110::bigint,'refund after payment debits reserve without capping');
select is((select balance_minor from public.account_balances where account_id = pg_temp.id('card B')),20::bigint,'refund after payment creates spendable positive card balance');
select pg_temp.activity('expense','card B',-10,'travel','2026-10-13');
select is(pg_temp.reserve('card B'),-110::bigint,'spending a positive card balance creates no new reserve');
select pg_temp.activity('expense','card B',-30,'refund deficit','2026-10-14');
select pg_temp.activity('refund','card B',20,'refund deficit','2026-10-15');
select is(pg_temp.balance('refund deficit'),-10::bigint,'refund repairs a negative chosen envelope');
select is(pg_temp.reserve('card B'),-130::bigint,'refund effects remain explicit when debt is already extinguished');
select pg_temp.allocate('investment funds',100);
select pg_temp.tx(jsonb_build_object('kind','transfer','effective_date','2026-10-05','entries',jsonb_build_array(
  jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-100'),jsonb_build_object('account_id',pg_temp.id('investment'),'amount_minor','100')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('investment funds'),'amount_minor','-100'))));
select pg_temp.activity('valuation','investment',25,null,'2026-10-06');
select is((select balance_minor from public.account_balances where account_id = pg_temp.id('investment')),125::bigint,'contribution and valuation both affect investment balance');
select is(pg_temp.balance('investment funds'),0::bigint,'only contribution affects envelopes');
select pg_temp.tx(jsonb_build_object('kind','transfer','effective_date','2026-10-07','entries',jsonb_build_array(
  jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-50'),jsonb_build_object('account_id',pg_temp.id('savings'),'amount_minor','50')),'splits','[]'::jsonb));
select is((select balance_minor from public.account_balances where account_id = pg_temp.id('savings')),50::bigint,'cash transfer has equal opposite account movement');
-- Split purchase and stale edits.
select pg_temp.tx(jsonb_build_object('kind','expense','effective_date','2026-10-08','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-12')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','-5'),jsonb_build_object('envelope_id',pg_temp.id('groceries'),'amount_minor','-7'))),jsonb_build_object('id',pg_temp.id('split purchase')));
select is((select sum(amount_minor)::bigint from public.transaction_splits where transaction_id = pg_temp.id('split purchase')),-12::bigint,'split purchase persists complete aggregate');
select pg_temp.cmd('transaction_void','{}',jsonb_build_object('id',pg_temp.id('split purchase'),'expected_version','1'));
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','transaction_void','id',pg_temp.id('split purchase'),'expected_version','1')),'stale edit is rejected');
select is((select version from public.transactions where id = pg_temp.id('split purchase')),2::bigint,'void advances aggregate version');
select ok(pg_temp.rejected('{"time_zone":"UTC","operation":"transaction_save","data":{"kind":"transfer","effective_date":"2026-10-01","entries":[],"splits":[]}}'),'invalid aggregate rolls back');
-- A schedule leaves actual balances unchanged, and posting has exactly one effect.
select pg_temp.tx(jsonb_build_object('kind','income','status','scheduled','effective_date','2026-10-20','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','100000')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','100000'))),jsonb_build_object('id',pg_temp.id('schedule')));
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-12-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-100000'),
  jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','100000'))),jsonb_build_object('id',pg_temp.id('unfunded future assignment')));
select ok((public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->>'ready_to_assign_minor')::bigint < 0,'Future assignment may overassign while scheduled income remains unposted');
select pg_temp.cmd('allocation_void','{}',jsonb_build_object('id',pg_temp.id('unfunded future assignment'),'expected_version',1));

select pg_temp.cmd('account_update','{"archived":true}',jsonb_build_object('id',pg_temp.id('cash')));
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','transaction_post','id',pg_temp.id('schedule'),'expected_version','1')),'archived account cannot receive a scheduled posting');
select pg_temp.cmd('account_update','{"archived":false}',jsonb_build_object('id',pg_temp.id('cash')));
select public.budgie_command(pg_temp.id('budget'),pg_temp.id('post retry'),jsonb_build_object('time_zone','UTC','operation','transaction_post','id',pg_temp.id('schedule'),'expected_version','1'));
select public.budgie_command(pg_temp.id('budget'),pg_temp.id('post retry'),jsonb_build_object('time_zone','UTC','operation','transaction_post','id',pg_temp.id('schedule'),'expected_version','1'));
select is((select version from public.transactions where id = pg_temp.id('schedule')),2::bigint,'posting retry does not increment version or double-post');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','owner_remove','data',jsonb_build_object('user_id',pg_temp.id('owner')))),'final owner cannot be removed');
select pg_temp.cmd('owner_add',jsonb_build_object('user_id',pg_temp.id('other owner')));
select is((select count(*) from public.budget_owners),2::bigint,'existing identity can become full owner');
-- Direct coverage retires debt eligibility before later partial lot funding.
select pg_temp.account('card C','credit');
select pg_temp.activity('expense','card C',-100,'direct debt','2026-10-03');
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-11-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-30'),
  jsonb_build_object('envelope_id',(select id from public.envelopes where credit_account_id = pg_temp.id('card C')),'amount_minor','30'))));
select pg_temp.allocate('direct debt',20,'2026-11-01');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where credit_account_id = pg_temp.id('card C') and month = '2026-11-01'),30::bigint,'partial deficit funding consumes existing direct coverage first');
select pg_temp.allocate('direct debt',50,'2026-11-01');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where credit_account_id = pg_temp.id('card C') and month = '2026-11-01'),70::bigint,'only newly covered eligible debt increases reserve');
-- Refund to a deficit on another card applies reserve release and funding separately.
select pg_temp.account('card D','credit');
select pg_temp.envelope('cross refund');
select pg_temp.activity('expense','card D',-40,'cross refund','2026-10-05');
select pg_temp.activity('refund','card C',20,'cross refund','2026-10-06');
select is(pg_temp.reserve('card C'),-20::bigint,'refund releases its own card reserve even when insufficient');
select is(pg_temp.reserve('card D'),20::bigint,'refund repairs oldest eligible deficit on its chosen envelope');
-- Renaming and archiving payees preserve references.
select pg_temp.cmd('payee_save','{"name":"  Supermarket  "}',jsonb_build_object('id',pg_temp.id('supermarket')));
select is((pg_temp.cmd('payee_save','{"name":"superMARKET"}')->>'id')::uuid,pg_temp.id('supermarket'),'normalized duplicate payee returns existing record');
select pg_temp.tx(jsonb_build_object('kind','expense','payee_id',pg_temp.id('supermarket'),'effective_date','2026-10-17','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-1')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','-1'))),jsonb_build_object('id',pg_temp.id('payee purchase')));
select pg_temp.cmd('payee_save','{"name":"Market renamed"}',jsonb_build_object('id',pg_temp.id('supermarket')));
select pg_temp.cmd('payee_archive','{}',jsonb_build_object('id',pg_temp.id('supermarket')));
select is((select p.name from public.transactions t join public.payees p on p.id = t.payee_id where t.id = pg_temp.id('payee purchase')),'Market renamed','archived renamed payee retains historical reference');
-- Reorder complete scopes and move envelopes while retaining unique ordering.
select pg_temp.cmd('reorder',jsonb_build_object('entity','account','ids',(select jsonb_agg(id order by sort_order desc) from public.accounts)));
select is((select sort_order from public.accounts where id = pg_temp.id('cash')),(select count(*)::integer-1 from public.accounts),'account position swaps succeed under deferred uniqueness');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','reorder','data',jsonb_build_object('entity','account','ids',jsonb_build_array(pg_temp.id('cash'),pg_temp.id('cash'))))),'duplicate reorder entries rejected');
select pg_temp.cmd('group_create','{"name":"Essentials"}',jsonb_build_object('id',pg_temp.id('essentials')));
select pg_temp.cmd('reorder',jsonb_build_object('entity','envelope','group_id',pg_temp.id('essentials'),'ids','[]'::jsonb));
select pass('empty scope accepts its complete empty ordering');
select pg_temp.cmd('envelope_move',jsonb_build_object('group_id',pg_temp.id('essentials')),jsonb_build_object('id',pg_temp.id('travel')));
select is((select group_id from public.envelopes where id = pg_temp.id('travel')),pg_temp.id('essentials'),'moving envelope changes group atomically');
select is((select count(*) from (select budget_id,group_id,sort_order from public.envelopes group by budget_id,group_id,sort_order having count(*) > 1) x),0::bigint,'envelope scopes retain unique positions');
-- Reconciliation is an ordinary correction and compares the date-specific preview.
create temporary table reconciliation_preview as select public.budgie_reconciliation_preview(pg_temp.id('budget'),pg_temp.id('savings'),'2026-10-20') as value;
select is((select value->>'recorded_minor' from reconciliation_preview),'50','preview includes recorded activity through selected date');
select pg_temp.cmd('reconcile',jsonb_build_object('account_id',pg_temp.id('savings'),'effective_date','2026-10-20','expected_recorded_minor','50','observed_minor','55','splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','5'))),jsonb_build_object('id',pg_temp.id('reconciliation')));
select is((select kind from public.transactions where id = pg_temp.id('reconciliation')),'adjustment','reconciliation uses ordinary adjustment');
select is((select amount_minor from public.account_entries where transaction_id = pg_temp.id('reconciliation')),5::bigint,'reconciliation records observed difference');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','reconcile','data',jsonb_build_object('account_id',pg_temp.id('savings'),'effective_date','2026-10-20','expected_recorded_minor','50','observed_minor','56','splits','[]'::jsonb))),'intervening activity rejects stale reconciliation preview');
select is(pg_temp.cmd('reconcile',jsonb_build_object('account_id',pg_temp.id('savings'),'effective_date','2026-10-20','expected_recorded_minor','55','observed_minor','55'))->>'difference_minor','0','zero reconciliation creates no transaction');
select is((select count(*) from public.transactions where kind = 'adjustment'),1::bigint,'only nonzero reconciliation writes an adjustment');
-- Backdated edits preserve creation sequence and later entered reconciliation.
select pg_temp.tx(jsonb_build_object('kind','expense','payee_id',null,'effective_date','2026-10-16','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-2')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('groceries'),'amount_minor','-2'))),jsonb_build_object('id',pg_temp.id('payee purchase'),'expected_version','1'));
select is((select version from public.transactions where id = pg_temp.id('payee purchase')),2::bigint,'backdated aggregate edit increments version');
select is((select amount_minor from public.account_entries where transaction_id = pg_temp.id('reconciliation')),5::bigint,'historical edits leave reconciliation amount unchanged');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','budget_update','data',jsonb_build_object('currency_code','USD'))),'currency cannot change after financial history');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','account_update','id',pg_temp.id('cash'),'data',jsonb_build_object('kind','investment'))),'account kind cannot change after activity');
select pg_temp.cmd('envelope_update','{"archived":true}',jsonb_build_object('id',pg_temp.id('travel')));
select is(pg_temp.balance('travel'),15::bigint,'archiving retains nonzero historical envelope balance');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','transaction_save','data',jsonb_build_object('kind','expense','effective_date','2026-10-21','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-1')),'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','-1'))))),'archived envelope rejects new activity');
select pg_temp.cmd('envelope_update','{"archived":false}',jsonb_build_object('id',pg_temp.id('travel')));
-- Owner role can see full history but cannot overwrite stale forms.
select set_config('request.jwt.claim.sub',pg_temp.id('other owner')::text,true);
select is((select count(*) from public.budgets),1::bigint,'second owner sees shared budget');
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','transaction_void','id',pg_temp.id('payee purchase'),'expected_version','1')),'another owner cannot overwrite version two with version one');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);

-- RTA later reservation is deducted once on month navigation.
select pg_temp.allocate('travel',300,'2026-12-01');
select is((public.budgie_snapshot(pg_temp.id('budget'),'2026-11-01','UTC')->>'ready_to_assign_minor')::bigint,
  (public.budgie_snapshot(pg_temp.id('budget'),'2026-12-01','UTC')->>'ready_to_assign_minor')::bigint,'future reservations deducted exactly once');
select public.budgie_snapshot(pg_temp.id('budget'),'2027-03-01','UTC') is not null as materialized;
select is(pg_temp.balance('groceries','2027-03-01'),pg_temp.balance('groceries','2026-12-01'),'positive carry through empty months');
select is(pg_temp.balance('mixed','2027-03-01'),-30::bigint,'negative carry through empty months');
select is((select count(*) from public.envelope_month_balances where closing_minor <> opening_minor+allocated_minor+activity_minor),0::bigint,'all monthly equations hold');
-- An actual historical correction remains recordable even if it exposes shortage.
select pg_temp.tx(jsonb_build_object('kind','adjustment','memo','Correct historical cash balance','effective_date','2026-10-01',
  'entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-200000')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-200000'))),jsonb_build_object('id',pg_temp.id('historical correction')));
select ok((public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->>'ready_to_assign_minor')::bigint < 0,'historical correction exposes overassignment without rejection');
create temp table shortage_before as select (public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->>'ready_to_assign_minor')::bigint amount;
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-12-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-1'),
  jsonb_build_object('envelope_id',pg_temp.id('travel'),'amount_minor','1'))),jsonb_build_object('id',pg_temp.id('worsened shortage')));
select is((public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->>'ready_to_assign_minor')::bigint,(select amount-1 from shortage_before),'Allocation may worsen existing Ready to assign shortage');
select pg_temp.cmd('allocation_void','{}',jsonb_build_object('id',pg_temp.id('worsened shortage'),'expected_version',1));
select pg_temp.cmd('transaction_void','{}',jsonb_build_object('id',pg_temp.id('historical correction'),'expected_version','1'));
-- Reuse is scoped to actor and exact command payload, even when authorized.
select public.budgie_command(pg_temp.id('budget'),pg_temp.id('request collision'),'{"time_zone":"UTC","operation":"rebuild"}');
select throws_ok(format('select public.budgie_command(%L,%L,%L)',pg_temp.id('budget'),pg_temp.id('request collision'),'{"time_zone":"Australia/Brisbane","operation":"rebuild"}'),'P0001','Request ID reused with different actor or payload','request UUID rejects changed payload');
select set_config('request.jwt.claim.sub',pg_temp.id('other owner')::text,true);
select throws_ok(format('select public.budgie_command(%L,%L,%L)',pg_temp.id('budget'),pg_temp.id('request collision'),'{"time_zone":"UTC","operation":"rebuild"}'),'P0001','Request ID reused with different actor or payload','request UUID rejects changed actor');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select ok(pg_temp.rejected(jsonb_build_object('time_zone','UTC','operation','transaction_save','data',jsonb_build_object('kind','transfer','effective_date','2026-10-01','entries',jsonb_build_array(
  jsonb_build_object('account_id',pg_temp.id('card A'),'amount_minor','-10'),jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','10')),'splits','[]'::jsonb))),'unsupported credit borrowing route rejected');

select pg_temp.account('release card','credit');
select pg_temp.envelope('release deficit');
select pg_temp.activity('expense','release card',-100,'release deficit','2026-10-04');
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-11-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-30'),
  jsonb_build_object('envelope_id',(select id from public.envelopes where credit_account_id = pg_temp.id('release card')),'amount_minor','30'))));
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-12-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where credit_account_id = pg_temp.id('release card')),'amount_minor','-30'),
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','30'))));
select pg_temp.allocate('release deficit',100,'2027-01-01');
select is((select closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where e.credit_account_id = pg_temp.id('release card') and month = '2027-01-01'),100::bigint,'released direct coverage becomes eligible again when later funded');

-- Rebuild equivalence over complete normalized caches.
create temporary table prior_lots as select * from public.deficit_lots;
create temporary table prior_accounts as select * from public.account_balances;
create temporary table prior_months as select * from public.envelope_month_balances;
select public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),'{"time_zone":"UTC","operation":"rebuild"}');
select is((select count(*) from ((select * from prior_accounts except select * from public.account_balances) union all (select * from public.account_balances except select * from prior_accounts)) x),0::bigint,'account summaries equal full rebuild');
select is((select count(*) from ((select * from prior_months except select * from public.envelope_month_balances) union all (select * from public.envelope_month_balances except select * from prior_months)) x),0::bigint,'monthly summaries equal full rebuild');
select ok((select count(*) from public.deficit_lots) > 0,'outstanding deficit lots are materialized');
select is(jsonb_typeof(public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->'deficits'->0->'ordinal'),'string','persisted bigint lot ordinals are encoded losslessly');
select is((select count(*) from ((select * from prior_lots except select * from public.deficit_lots) union all (select * from public.deficit_lots except select * from prior_lots)) x),0::bigint,'persistent deficit lots equal a full rebuild');
select is((select count(*) from public.deficit_lots where remaining_minor = 0),0::bigint,'settled lots are removed after replay');
-- Two budgets share ordinal values, but their rebuilds must remain isolated.
select public.budgie_create_budget(pg_temp.id('foreign budget'),gen_random_uuid(),'{"name":"Isolated budget","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}');
select public.budgie_command(pg_temp.id('foreign budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation','account_create','id',pg_temp.id('foreign cash'),'data',jsonb_build_object('name','Foreign cash','kind','cash')));
select public.budgie_command(pg_temp.id('foreign budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation','envelope_create','id',pg_temp.id('foreign envelope'),'data',jsonb_build_object('name','Foreign spending')));
select public.budgie_command(pg_temp.id('foreign budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation','transaction_save','data',jsonb_build_object('kind','expense','effective_date','2026-10-05','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('foreign cash'),'amount_minor','-70')),'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('foreign envelope'),'amount_minor','-70')))));
select is((select count(*) from ((select * from prior_lots except select * from public.deficit_lots where budget_id = pg_temp.id('budget')) union all (select * from public.deficit_lots where budget_id = pg_temp.id('budget') except select * from prior_lots)) x),0::bigint,'another budget replay preserves existing lots');
create temporary table foreign_lots as select * from public.deficit_lots where budget_id = pg_temp.id('foreign budget');
select public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),'{"time_zone":"UTC","operation":"rebuild"}');
select is((select remaining_minor from public.deficit_lots where budget_id = pg_temp.id('foreign budget')),70::bigint,'rebuilding one budget preserves another budget deficit');
select is((select count(*) from ((select * from foreign_lots except select * from public.deficit_lots where budget_id = pg_temp.id('foreign budget')) union all (select * from public.deficit_lots where budget_id = pg_temp.id('foreign budget') except select * from foreign_lots)) x),0::bigint,'budget-local lot ordinals cannot cross-update another budget');
select is(public.budgie_snapshot(pg_temp.id('foreign budget'),'2026-10-01','UTC')->'overview'->>'cash_minor',
  '-70','Checkpoint overview stays scoped to its budget');
-- Permissions are checked as actual API roles, including non-financial caches.
select ok(bool_and(c.relrowsecurity),'RLS enabled on every Budgie table') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
select ok(bool_and(not has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE,TRUNCATE')),'all direct client writes revoked') from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r';
select set_config('request.jwt.claim.sub',pg_temp.id('outsider')::text,true);
select is((select count(*) from public.budgets),0::bigint,'outsider sees no budgets');
select is((select count(*) from public.account_balances),0::bigint,'outsider sees no cached balances');
select is((select count(*) from public.audit_events),0::bigint,'outsider sees no audit history');
select is((select count(*) from public.deficit_lots),0::bigint,'outsider sees no persisted deficit lots');
select throws_ok('delete from public.deficit_lots','42501',null,'direct client deficit lot mutation denied');
select ok(pg_temp.rejected('{"time_zone":"UTC","operation":"rebuild"}'),'outsider cannot mutate budget');
select throws_ok('select public.budgie_snapshot(pg_temp.id(''budget''),''2026-10-01'',''UTC'')','42501','Budget access denied','snapshot rejects outsider');
select throws_ok('insert into public.account_balances values (gen_random_uuid(),gen_random_uuid(),1)','42501',null,'direct client cache mutation denied');
select throws_ok('delete from public.audit_events','42501',null,'audit deletion denied');
select throws_ok('update public.transactions set memo = ''tamper''','42501',null,'direct transaction mutation denied');
set local role anon;
select throws_ok('select public.budgie_command(gen_random_uuid(),gen_random_uuid(),''{}'')','42501',null,'anonymous RPC execution denied');
reset role;
set constraints all immediate;
select * from finish();
rollback;
