alter table public.profiles alter column ghl_user_id drop not null;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select p.app_role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1;
$$;

create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_app_role() = 'admin'::public.app_role;
$$;

revoke all on function public.current_app_role() from public;
revoke all on function public.is_active_app_user() from public;
revoke all on function public.is_app_admin() from public;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_update_self_not_role" on public.profiles;
drop policy if exists "profiles_admin_full_access" on public.profiles;
drop policy if exists "contacts_cache_admin_full_access" on public.contacts_cache;
drop policy if exists "contacts_cache_agent_assigned_only" on public.contacts_cache;
drop policy if exists "work_sessions_agent_own_or_admin" on public.work_sessions;
drop policy if exists "activity_logs_agent_own_or_admin" on public.activity_logs;
drop policy if exists "calls_agent_own_or_admin" on public.calls;
drop policy if exists "call_dispositions_agent_own_or_admin" on public.call_dispositions;
drop policy if exists "callbacks_agent_own_or_admin" on public.callbacks;
drop policy if exists "webhook_events_admin_only" on public.webhook_events;
drop policy if exists "audit_logs_admin_only" on public.audit_logs;

create policy "profiles_select_own_or_admin"
on public.profiles for select to authenticated
using (id = auth.uid() or public.is_app_admin());

create policy "profiles_admin_select"
on public.profiles for update to authenticated
using (public.is_app_admin())
with check (public.is_app_admin());

create policy "contacts_cache_select_authorized"
on public.contacts_cache for select to authenticated
using (
  public.is_active_app_user()
  and (
    public.is_app_admin()
    or (
      assigned_ghl_user_id = (select p.ghl_user_id from public.profiles p where p.id = auth.uid())
      and lower(current_status) = 'open'
    )
  )
);

create policy "work_sessions_select_own_or_admin"
on public.work_sessions for select to authenticated
using (agent_id = auth.uid() or public.is_app_admin());

create policy "activity_logs_select_own_or_admin"
on public.activity_logs for select to authenticated
using (actor_id = auth.uid() or public.is_app_admin());

create policy "calls_select_own_or_admin"
on public.calls for select to authenticated
using (agent_id = auth.uid() or public.is_app_admin());

create policy "call_dispositions_select_own_or_admin"
on public.call_dispositions for select to authenticated
using (agent_id = auth.uid() or public.is_app_admin());

create policy "callbacks_select_own_or_admin"
on public.callbacks for select to authenticated
using (agent_id = auth.uid() or public.is_app_admin());

create policy "webhook_events_admin_select"
on public.webhook_events for select to authenticated
using (public.is_app_admin());

create policy "audit_logs_admin_select"
on public.audit_logs for select to authenticated
using (public.is_app_admin());

comment on function public.current_app_role() is 'Returns the active application role for auth.uid() without recursive RLS evaluation.';
comment on function public.is_active_app_user() is 'Checks profile activation using a fixed-search-path security definer function.';
comment on function public.is_app_admin() is 'Checks admin role using the server-owned profile mapping.';