alter table public.user_roles
  add column if not exists is_retired boolean not null default false;

comment on column public.user_roles.is_retired is '퇴사 여부';

grant select (is_retired)
on table public.user_roles
to authenticated;

grant update (is_retired)
on table public.user_roles
to authenticated;

drop policy if exists user_roles_update_hire_dates_admin on public.user_roles;
drop policy if exists user_roles_update_employee_admin on public.user_roles;

create policy user_roles_update_employee_admin
on public.user_roles
for update
to authenticated
using ((select private.is_current_user_admin()))
with check ((select private.is_current_user_admin()));
