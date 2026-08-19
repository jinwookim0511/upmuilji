drop policy if exists work_logs_insert_authenticated on public.work_logs;

create policy work_logs_insert_authenticated
on public.work_logs
for insert
to authenticated
with check (
  user_id = (select auth.uid())
  and email = (
    select user_roles.email
    from public.user_roles
    where user_roles.id = (select auth.uid())
      and user_roles.role = '직원'
  )
  and status = any (array['작성중'::text, '서명 대기'::text])
);

create or replace function public.enforce_admin_work_log_status_only()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.user_roles
    where id = (select auth.uid())
      and role = '관리자'
  ) and (
    new.id is distinct from old.id
    or new.user_id is distinct from old.user_id
    or new.email is distinct from old.email
    or new.week is distinct from old.week
    or new.data is distinct from old.data
    or new.created_at is distinct from old.created_at
  ) then
    raise exception using
      errcode = '42501',
      message = '관리자는 업무일지 내용 필드를 수정할 수 없습니다.';
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_admin_work_log_status_only() from public, anon, authenticated;

drop trigger if exists enforce_admin_work_log_status_only on public.work_logs;

create trigger enforce_admin_work_log_status_only
before update on public.work_logs
for each row
execute function public.enforce_admin_work_log_status_only();
