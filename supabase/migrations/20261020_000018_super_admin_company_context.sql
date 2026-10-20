create or replace function public.current_company_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  selected_company_id text;
begin
  if public.is_super_admin() then
    selected_company_id := current_setting('request.headers', true)::json ->> 'x-company-context';
    if selected_company_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      return selected_company_id::uuid;
    end if;
    return null;
  end if;

  return (
    select m.company_id
    from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = auth.uid() and m.is_active and p.is_active and c.status = 'active'
    limit 1
  );
end;
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select (
    p_company_id is not null
    and public.is_super_admin()
    and p_company_id = public.current_company_id()
  ) or exists (
    select 1 from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = auth.uid() and m.company_id = p_company_id
      and m.role = 'admin' and m.is_active and p.is_active and c.status = 'active'
  );
$$;

create or replace function public.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_super_admin() and public.current_company_id() is not null then 'admin'::public.app_role
    else (
      select m.role from public.company_memberships m
      where m.profile_id = auth.uid() and m.is_active limit 1
    )
  end;
$$;

drop policy if exists profiles_read_company on public.profiles;
create policy profiles_read_company
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (
    public.is_super_admin()
    and (
      public.current_company_id() is null
      or exists (
        select 1 from public.company_memberships target_membership
        where target_membership.profile_id = profiles.id
          and target_membership.company_id = public.current_company_id()
      )
    )
  )
  or exists (
    select 1 from public.company_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.is_company_admin(target_membership.company_id)
  )
);

create or replace function public.assign_company_from_actor()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_id_value uuid;
  company_id_value uuid;
begin
  if tg_table_name in ('work_sessions', 'calls', 'call_dispositions', 'callbacks') then
    profile_id_value := new.agent_id;
  else
    profile_id_value := new.actor_id;
  end if;

  if profile_id_value = auth.uid() and public.is_super_admin() then
    company_id_value := public.current_company_id();
    if company_id_value is null or (new.company_id is not null and new.company_id <> company_id_value) then
      raise exception 'active_company_admin_required';
    end if;
  else
    select m.company_id into company_id_value
    from public.company_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.companies c on c.id = m.company_id
    where m.profile_id = profile_id_value and m.is_active and p.is_active and c.status = 'active';
    if company_id_value is null then raise exception 'active_company_membership_required'; end if;
    if new.company_id is not null and new.company_id <> company_id_value then raise exception 'company_membership_mismatch'; end if;
  end if;

  new.company_id := company_id_value;
  return new;
end;
$$;

create or replace function public.validate_company_contact_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.assigned_agent_id is not null and not exists (
    select 1 from public.company_memberships m
    join public.profiles p on p.id = m.profile_id
    join public.companies c on c.id = m.company_id
    where m.profile_id = new.assigned_agent_id and m.company_id = new.company_id
      and m.role = 'agent' and m.is_active and p.is_active
      and (c.status = 'active' or (public.is_super_admin() and public.current_company_id() = new.company_id))
  ) then
    raise exception 'assigned_agent_must_be_active_company_member';
  end if;
  return new;
end;
$$;
