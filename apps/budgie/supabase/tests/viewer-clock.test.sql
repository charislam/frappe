begin;
create extension if not exists pgtap with schema extensions;
set search_path = public,extensions;
select no_plan();
set client_min_messages = warning;

select is(budgie_private.local_date('Australia/Brisbane','2026-10-22 23:00:00+00'),date '2026-10-23',
  '9am in UTC+10 uses the local calendar day, not the previous UTC day');
select is(budgie_private.local_date('America/Los_Angeles','2026-10-22 23:00:00+00'),date '2026-10-22',
  'The same instant can belong to the previous day for another viewer');
select is(budgie_private.local_date('America/New_York','2026-03-09 04:30:00+00'),date '2026-03-09',
  'Named timezones use the daylight-saving offset after the transition');
select is(budgie_private.local_date('America/New_York','2026-03-07 04:30:00+00'),date '2026-03-06',
  'Named timezones use the standard offset before the transition');
select throws_ok($$select budgie_private.local_date('Mars/Olympus')$$,'P0001','Valid viewer time zone required','Unknown timezone is rejected');
select throws_ok($$select budgie_private.local_date(null)$$,'P0001','Valid viewer time zone required','Missing timezone is rejected');

create function pg_temp.id(label text) returns uuid language sql immutable as $$ select md5('viewer-clock:' || label)::uuid $$;
create function pg_temp.day(zone text) returns date language sql security definer set search_path = '' as $$
  select budgie_private.local_date(zone) $$;
create function pg_temp.cmd(command jsonb) returns jsonb language sql as $$
  select public.budgie_command(pg_temp.id('budget'),gen_random_uuid(),'{"time_zone":"Pacific/Kiritimati"}'::jsonb || command) $$;
create function pg_temp.activity(day date) returns jsonb language sql as $$
  select jsonb_build_object('kind','income','effective_date',day,
    'entries',jsonb_build_array(jsonb_build_object('account_id',pg_temp.id('cash'),'amount_minor','100')),
    'splits',jsonb_build_array(jsonb_build_object('envelope_id',e.id,'amount_minor','100')))
  from public.envelopes e where budget_id = pg_temp.id('budget') and kind = 'ready_to_assign' $$;
insert into auth.users(id) values(pg_temp.id('owner')),(pg_temp.id('other'));
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
set local role authenticated;
select public.budgie_create_budget(pg_temp.id('budget'),gen_random_uuid(),
  '{"name":"Viewer clock","currency_code":"CAD","minor_unit_scale":2,"time_zone":"Pacific/Kiritimati"}');
select pg_temp.cmd(jsonb_build_object('operation','account_create','id',pg_temp.id('cash'),'data',jsonb_build_object('name','Cash','kind','cash')));
select pg_temp.cmd(jsonb_build_object('operation','owner_add','data',jsonb_build_object('user_id',pg_temp.id('other'))));
select is(pg_temp.day('Pacific/Kiritimati'),pg_temp.day('Pacific/Honolulu')+1,
  'The two test viewers have different local dates at the same server instant');

-- A legacy caller-selected date cannot override the clock in the viewer's zone.
select throws_ok(format('select pg_temp.cmd(%L)',jsonb_build_object('operation','transaction_save',
  'time_zone','Pacific/Honolulu','as_of','2999-12-31','data',pg_temp.activity(pg_temp.day('Pacific/Kiritimati')))),
  'P0001','Cannot post future activity','Future transaction is rejected even with an obsolete date override');
select pg_temp.cmd(jsonb_build_object('operation','transaction_save','id',pg_temp.id('schedule'),
  'time_zone','Pacific/Honolulu','data',pg_temp.activity(pg_temp.day('Pacific/Kiritimati')) || '{"status":"scheduled"}'));
select set_config('request.jwt.claim.sub',pg_temp.id('other')::text,true);
select throws_ok(format('select pg_temp.cmd(%L)',jsonb_build_object('operation','transaction_post',
  'time_zone','Pacific/Honolulu','id',pg_temp.id('schedule'),'expected_version','1')),
  'P0001','Schedule is not due','An owner whose local day is earlier cannot post the schedule yet');
select set_config('request.jwt.claim.sub',pg_temp.id('owner')::text,true);
select lives_ok(format('select pg_temp.cmd(%L)',jsonb_build_object('operation','transaction_post',
  'id',pg_temp.id('schedule'),'expected_version','1')),'The same schedule is due for an owner whose local day has arrived');
select is((select balance_minor from public.account_balances where account_id = pg_temp.id('cash')),100::bigint,'Local-today posting updates actual balances');
select lives_ok(format('select pg_temp.cmd(%L)',jsonb_build_object('operation','transaction_save',
  'time_zone','Pacific/Honolulu','data',pg_temp.activity(pg_temp.day('Pacific/Honolulu')))),
  'Posting on the viewer current day works without a caller-supplied date limit');
select throws_ok(format('select pg_temp.cmd(%L)',jsonb_build_object('operation','rebuild','time_zone','Mars/Olympus')),
  'P0001','Valid viewer time zone required','Commands validate the viewer timezone');
select throws_ok(format('select public.budgie_snapshot(%L,%L,%L)',pg_temp.id('budget'),'2026-10-01','Mars/Olympus'),
  'P0001','Valid viewer time zone required','Snapshots validate the viewer timezone');
select lives_ok(format('select public.budgie_snapshot(%L,%L,%L)',pg_temp.id('budget'),
  date_trunc('month',pg_temp.day('Pacific/Honolulu')+interval '2 months')::date,'Pacific/Honolulu'),
  'The requested snapshot month can extend the cache without an as-of parameter');
select is((public.budgie_snapshot(pg_temp.id('budget'),'2026-10-01','Pacific/Honolulu')->'envelopes'->0->>'month'),
  '2026-10-01','Requested month, rather than the viewer local day, selects displayed envelope totals');
reset role;
select * from finish();
rollback;
