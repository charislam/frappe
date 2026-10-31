-- Match ECMAScript String.trim, and count Unicode code points with char_length.
create function public.trim_text(value text) returns text
language sql immutable strict set search_path = '' as $$
  select btrim(value, chr(9)||chr(10)||chr(11)||chr(12)||chr(13)||chr(32)||chr(160)||chr(5760)||chr(8192)||chr(8193)||chr(8194)||chr(8195)||chr(8196)||chr(8197)||chr(8198)||chr(8199)||chr(8200)||chr(8201)||chr(8202)||chr(8232)||chr(8233)||chr(8239)||chr(8287)||chr(12288)||chr(65279));
$$;
create table public.budgets (
  id uuid primary key,
  name text not null check (name = public.trim_text(name) and char_length(name) between 1 and 200),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);
create table public.budget_members (
  user_id uuid not null references auth.users(id) on delete cascade,
  budget_id uuid not null references public.budgets(id) on delete cascade,
  primary key (user_id, budget_id)
);
create index budget_members_budget_idx on public.budget_members (budget_id, user_id);
create index budgets_order_idx on public.budgets (created_at, id);
alter table public.budgets enable row level security;
alter table public.budget_members enable row level security;
revoke all on public.budgets, public.budget_members from anon, authenticated;
grant select on public.budgets, public.budget_members to authenticated;
grant update(name, archived_at), delete on public.budgets to authenticated;
create policy own_membership on public.budget_members for select to authenticated
using (user_id = (select auth.uid()));
create policy member_read on public.budgets for select to authenticated
using (id in (select budget_id from public.budget_members where user_id = (select auth.uid())));
create policy member_update on public.budgets for update to authenticated
using (id in (select budget_id from public.budget_members where user_id = (select auth.uid())))
with check (id in (select budget_id from public.budget_members where user_id = (select auth.uid())));
create policy member_delete on public.budgets for delete to authenticated
using (id in (select budget_id from public.budget_members where user_id = (select auth.uid())));

-- Definer authority is limited to the atomic initial budget/membership pair.
-- Clients cannot insert memberships or choose a creator; auth.uid is authoritative.
create schema if not exists budgie_private;
revoke all on schema budgie_private from public;
grant usage on schema budgie_private to authenticated;
create function budgie_private.create_budget(budget_id uuid, budget_name text) returns public.budgets
language plpgsql security definer set search_path = '' as $$
declare result public.budgets;
begin
  if auth.uid() is null then raise insufficient_privilege using message = 'Authentication required'; end if;
  insert into public.budgets(id, name) values (budget_id, public.trim_text(budget_name))
  on conflict (id) do nothing returning * into result;
  if result.id is not null then
    insert into public.budget_members(user_id, budget_id) values (auth.uid(), result.id);
  else
    select b.* into result from public.budgets b
    join public.budget_members m on m.budget_id = b.id
    where b.id = create_budget.budget_id and m.user_id = auth.uid();
    if result.id is null then raise insufficient_privilege using message = 'Budget unavailable'; end if;
  end if;
  return result;
end;
$$;
revoke all on function budgie_private.create_budget(uuid, text) from public, anon;
grant execute on function budgie_private.create_budget(uuid, text) to authenticated;
create function public.create_budget(budget_id uuid, budget_name text) returns public.budgets
language sql security invoker set search_path = '' as $$
  select budgie_private.create_budget(budget_id, budget_name);
$$;
revoke all on function public.create_budget(uuid, text) from public, anon;
grant execute on function public.create_budget(uuid, text) to authenticated;
