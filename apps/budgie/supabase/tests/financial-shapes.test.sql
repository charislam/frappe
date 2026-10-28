begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
set client_min_messages = warning;
select no_plan();
create function pg_temp.id(label text) returns uuid language sql immutable as $$ select md5('shapes:' || label)::uuid $$;
insert into auth.users (id) values (pg_temp.id('owner'));
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
create function pg_temp.cmd(op text,data jsonb,entity text default null) returns jsonb language sql as $$
  select pg_temp.verify_projection(public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation',op,'data',data) || case when entity is null then '{}' else jsonb_build_object('id',pg_temp.id(entity)) end)) $$;
create function pg_temp.reserve(card text,month date default '2026-10-01') returns bigint language sql as $$
  select b.closing_minor from public.envelope_month_balances b join public.envelopes e on e.id = b.envelope_id where credit_account_id = pg_temp.id(card) and b.month = reserve.month $$;
select public.budgie_create_budget(pg_temp.id('budget'),gen_random_uuid(),'{"name":"Cash-only then credit","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}');
select pg_temp.cmd('account_create','{"name":"Cash","kind":"cash"}','cash');
select pg_temp.cmd('envelope_create','{"name":"Food"}','food');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','opening_balance','effective_date','2026-10-01','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','9007199254740993')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','9007199254740993'))));
select is((public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','UTC')->'accounts'->0->>'balance_minor'),'9007199254740993','snapshot encodes bigint beyond JS precision as exact decimal string');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','expense','effective_date','2026-10-02','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-13')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','-13'))));
select is((select sum(closing_minor)::bigint from public.envelope_month_balances where month = '2026-10-01'),(select sum(balance_minor)::bigint from public.account_balances),'cash-only envelopes sum to actual cash even when a category is negative');
select pg_temp.cmd('account_create','{"name":"Old card debt","kind":"credit"}','debt');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','opening_balance','effective_date','2026-10-01','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('debt'),'amount_minor','-80')),'splits','[]'::jsonb));
select is(pg_temp.reserve('debt'),0::bigint,'negative credit opening creates uncovered debt without envelope debit');
select pg_temp.cmd('account_create','{"name":"Positive card opening","kind":"credit"}','positive');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','opening_balance','effective_date','2026-10-01','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('positive'),'amount_minor','50')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','50'))));
select is(pg_temp.reserve('positive'),0::bigint,'positive credit opening funds Ready to assign without reserve');
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-10-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','-100'),jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','100'))));
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','expense','effective_date','2026-10-03','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('positive'),'amount_minor','-80')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','-80'))));
select is(pg_temp.reserve('positive'),30::bigint,'purchase consumes positive card balance before generating new debt reserve');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','refund','effective_date','2026-10-04','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('positive'),'amount_minor','20')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('food'),'amount_minor','20'))));
select is(pg_temp.reserve('positive'),10::bigint,'funded independent refund releases the exact reserve amount');
select pg_temp.cmd('account_create','{"name":"Investment","kind":"investment"}','investment');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','opening_balance','effective_date','2026-10-01','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('investment'),'amount_minor','100')),'splits','[]'::jsonb));
select is((select balance_minor from public.account_balances where account_id = pg_temp.id('investment')),100::bigint,'investment opening has only investment balance effect');
-- Future releases are allowed; scheduled income remains excluded from actual balances.
select pg_temp.cmd('envelope_create','{"name":"Future income"}','future income');
select pg_temp.cmd('transaction_save',jsonb_build_object('kind','income','status','scheduled','effective_date','2026-10-30','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','500')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('future income'),'amount_minor','500'))));
select pg_temp.cmd('allocation_save',jsonb_build_object('month','2026-11-01','entries',jsonb_build_array(
  jsonb_build_object('envelope_id',pg_temp.id('future income'),'amount_minor','-500'),jsonb_build_object('envelope_id',(select id from public.envelopes where kind = 'ready_to_assign'),'amount_minor','500'))));
select is((select closing_minor from public.envelope_month_balances where envelope_id = pg_temp.id('future income') and month = '2026-11-01'),
  -500::bigint,'Future release is allowed and scheduled income does not hide its shortage');
select is((select count(*) from public.budgie_scheduled_forecast),1::bigint,'forecast exposes schedules separately');
select public.budgie_create_budget(pg_temp.id('foreign budget'),gen_random_uuid(),'{"name":"Other budget","currency_code":"CAD","minor_unit_scale":2,"time_zone":"UTC"}');
select public.budgie_command(pg_temp.id('foreign budget'),gen_random_uuid(),jsonb_build_object('time_zone','UTC','operation','envelope_create','id',pg_temp.id('foreign envelope'),'data',jsonb_build_object('name','Foreign')));
select throws_ok(format('select public.budgie_command(%L,gen_random_uuid(),%L)',pg_temp.id('budget'),jsonb_build_object('time_zone','UTC','operation','transaction_save','data',jsonb_build_object('kind','expense','effective_date','2026-10-03','entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','-1')),
  'splits',jsonb_build_array(jsonb_build_object('envelope_id',pg_temp.id('foreign envelope'),'amount_minor','-1'))))),'P0001','Active budget envelope required','even a shared owner cannot attach another budget envelope');
reset role;
set constraints all immediate;
select * from finish();
rollback;
