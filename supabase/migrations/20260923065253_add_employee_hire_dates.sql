alter table public.user_roles
  add column if not exists hire_date date,
  add column if not exists administrative_hire_date date;

comment on column public.user_roles.hire_date is '실제 입사일';
comment on column public.user_roles.administrative_hire_date is '행정적 입사일';

create schema if not exists private;

create or replace function private.is_current_user_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.user_roles
    where id = (select auth.uid())
      and role = '관리자'
  );
$$;

revoke all on function private.is_current_user_admin() from public;
grant usage on schema private to authenticated;
grant execute on function private.is_current_user_admin() to authenticated;

grant update (hire_date, administrative_hire_date)
on table public.user_roles
to authenticated;

drop policy if exists user_roles_update_hire_dates_admin on public.user_roles;

create policy user_roles_update_hire_dates_admin
on public.user_roles
for update
to authenticated
using ((select private.is_current_user_admin()))
with check ((select private.is_current_user_admin()));
