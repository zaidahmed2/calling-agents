create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 160),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  initial_admin_email citext,
  status text not null default 'setup' check (status in ('setup', 'active', 'inactive')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column platform_role text not null default 'user'
    check (platform_role in ('user', 'super_admin'));

insert into public.companies (name, slug, initial_admin_email, status)
select 'Legacy Workspace', 'legacy-workspace',
  (select p.normalized_email from public.profiles p where p.app_role = 'admin' and p.is_active order by p.created_at, p.id limit 1),
  'active'
on conflict (slug) do nothing;

create table public.company_memberships (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete restrict,
  role public.app_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, company_id)
);

insert into public.company_memberships (profile_id, company_id, role, is_active)
select p.id, c.id, p.app_role, p.is_active
from public.profiles p
cross join public.companies c
where c.slug = 'legacy-workspace'
on conflict (profile_id) do nothing;

create table public.company_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email citext not null,
  role public.app_role not null,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz not null default now()
);

create unique index company_invitations_pending_email
  on public.company_invitations (company_id, email) where accepted_at is null;

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  email citext,
  status text not null default 'open',
  subject text,
  notes text,
  lead_source text,
  assigned_agent_id uuid references public.profiles(id) on delete set null,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  external_provider text,
  external_contact_id text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(first_name) + length(last_name) > 0),
  check (external_provider is null or external_provider in ('ghl')),
  unique (company_id, external_provider, external_contact_id)
);

create index contacts_company_status on public.contacts (company_id, lower(status));
create index contacts_assigned_agent on public.contacts (company_id, assigned_agent_id);
create index contacts_company_email on public.contacts (company_id, email);

create table public.company_integrations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('ghl', 'crazytel')),
  enabled boolean not null default false,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object'),
  connection_status text not null default 'not_configured'
    check (connection_status in ('not_configured', 'connected', 'failed', 'disabled')),
  last_error text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider)
);

create table public.company_integration_secrets (
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider in ('ghl', 'crazytel')),
  credentials_ciphertext text not null,
  updated_at timestamptz not null default now(),
  primary key (company_id, provider)
);

create table public.company_field_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider = 'ghl'),
  internal_field text not null,
  external_field_id text not null,
  external_field_name text not null,
  external_field_type text,
  sync_direction text not null default 'both' check (sync_direction in ('import', 'export', 'both', 'disabled')),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, internal_field),
  unique (company_id, provider, external_field_id)
);

create table public.company_external_fields (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider = 'ghl'),
  external_field_id text not null,
  name text not null,
  field_type text,
  metadata jsonb not null default '{}'::jsonb,
  available boolean not null default true,
  refreshed_at timestamptz not null default now(),
  unique (company_id, provider, external_field_id)
);

create table public.company_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  provider text not null check (provider = 'ghl'),
  operation text not null check (operation in ('field_refresh', 'import', 'export')),
  state text not null default 'running' check (state in ('running', 'completed', 'failed', 'partial')),
  imported_count integer not null default 0,
  exported_count integer not null default 0,
  skipped_count integer not null default 0,
  failed_count integer not null default 0,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

do $$
declare
  legacy_company_id uuid;
  table_name text;
begin
  select id into strict legacy_company_id from public.companies where slug = 'legacy-workspace';
  foreach table_name in array array[
    'contacts_cache', 'work_sessions', 'activity_logs', 'calls',
    'call_dispositions', 'callbacks', 'contact_assignment_events',
    'webhook_events', 'audit_logs'
  ] loop
    if to_regclass(format('public.%I', table_name)) is not null then
      execute format('alter table public.%I add column if not exists company_id uuid references public.companies(id)', table_name);
      execute format('update public.%I set company_id = $1 where company_id is null', table_name) using legacy_company_id;
      execute format('alter table public.%I alter column company_id set default %L::uuid', table_name, legacy_company_id);
      execute format('alter table public.%I alter column company_id set not null', table_name);
      execute format('create index if not exists %I on public.%I (company_id)', 'idx_' || table_name || '_company_id', table_name);
    end if;
  end loop;
end;
$$;

alter table public.calls add column internal_contact_id uuid references public.contacts(id) on delete set null;
alter table public.callbacks add column internal_contact_id uuid references public.contacts(id) on delete set null;
alter table public.contact_assignment_events add column internal_contact_id uuid references public.contacts(id) on delete set null;
alter table public.contact_assignment_events add column from_agent_id uuid references public.profiles(id) on delete set null;
alter table public.contact_assignment_events add column to_agent_id uuid references public.profiles(id) on delete set null;
alter table public.contact_assignment_events alter column ghl_contact_id drop not null;
alter table public.contact_assignment_events drop constraint if exists contact_assignment_events_change_check;
alter table public.contact_assignment_events add constraint contact_assignment_events_change_check check (
  (internal_contact_id is not null and from_agent_id is distinct from to_agent_id)
  or (internal_contact_id is null and from_ghl_user_id is distinct from to_ghl_user_id)
);

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select m.company_id
  from public.company_memberships m
  join public.companies c on c.id = m.company_id
  join public.profiles p on p.id = m.profile_id
  where m.profile_id = auth.uid() and m.is_active and p.is_active and c.status = 'active'
  limit 1;
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active and p.platform_role = 'super_admin'
  );
$$;

create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = auth.uid() and m.company_id = p_company_id
      and m.is_active and p.is_active and c.status = 'active'
  );
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
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
  select m.role from public.company_memberships m
  where m.profile_id = auth.uid() and m.is_active limit 1;
$$;

create or replace function public.is_active_app_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_super_admin() or exists (
    select 1 from public.company_memberships m
    join public.companies c on c.id = m.company_id
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = auth.uid() and m.is_active and p.is_active and c.status = 'active'
  );
$$;

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_company_admin(public.current_company_id());
$$;

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
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies c on c.id = m.company_id
  where m.profile_id = profile_id_value and m.is_active and p.is_active and c.status = 'active';
  if company_id_value is null then raise exception 'active_company_membership_required'; end if;
  if new.company_id is not null and new.company_id <> company_id_value then raise exception 'company_membership_mismatch'; end if;
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
      and m.role = 'agent' and m.is_active and p.is_active and c.status = 'active'
  ) then
    raise exception 'assigned_agent_must_be_active_company_member';
  end if;
  return new;
end;
$$;

revoke all on function public.current_company_id() from public;
revoke all on function public.is_super_admin() from public;
revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.is_company_admin(uuid) from public;
grant execute on function public.current_company_id() to authenticated;
grant execute on function public.is_super_admin() to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_company_admin(uuid) to authenticated;
grant execute on function public.current_app_role() to authenticated;
grant execute on function public.is_active_app_user() to authenticated;
grant execute on function public.is_app_admin() to authenticated;

create trigger trg_companies_updated_at before update on public.companies
for each row execute function public.set_updated_at();
create trigger trg_contacts_updated_at before update on public.contacts
for each row execute function public.set_updated_at();
create trigger trg_contacts_validate_agent before insert or update of assigned_agent_id, company_id on public.contacts
for each row execute function public.validate_company_contact_agent();
create trigger trg_company_integrations_updated_at before update on public.company_integrations
for each row execute function public.set_updated_at();
create trigger trg_work_sessions_company before insert on public.work_sessions
for each row execute function public.assign_company_from_actor();
create trigger trg_calls_company before insert on public.calls
for each row execute function public.assign_company_from_actor();
create trigger trg_call_dispositions_company before insert on public.call_dispositions
for each row execute function public.assign_company_from_actor();
create trigger trg_callbacks_company before insert on public.callbacks
for each row execute function public.assign_company_from_actor();
create trigger trg_activity_logs_company before insert on public.activity_logs
for each row execute function public.assign_company_from_actor();
create trigger trg_audit_logs_company before insert on public.audit_logs
for each row execute function public.assign_company_from_actor();
create trigger trg_assignment_events_company before insert on public.contact_assignment_events
for each row execute function public.assign_company_from_actor();

alter table public.companies enable row level security;
alter table public.company_memberships enable row level security;
alter table public.company_invitations enable row level security;
alter table public.contacts enable row level security;
alter table public.company_integrations enable row level security;
alter table public.company_integration_secrets enable row level security;
alter table public.company_field_mappings enable row level security;
alter table public.company_external_fields enable row level security;
alter table public.company_sync_runs enable row level security;

create policy companies_read_member_or_platform
on public.companies for select to authenticated
using (public.is_super_admin() or public.is_company_member(id));
create policy companies_manage_platform
on public.companies for all to authenticated
using (public.is_super_admin()) with check (public.is_super_admin());

create policy memberships_read_company
on public.company_memberships for select to authenticated
using (profile_id = auth.uid() or public.is_company_admin(company_id) or public.is_super_admin());
create policy memberships_manage_company
on public.company_memberships for all to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin())
with check (public.is_company_admin(company_id) or public.is_super_admin());

create policy invitations_read_company
on public.company_invitations for select to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin());
create policy invitations_manage_company
on public.company_invitations for all to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin())
with check (public.is_company_admin(company_id) or public.is_super_admin());

create policy contacts_read_company
on public.contacts for select to authenticated
using (public.is_company_admin(company_id) or (public.is_company_member(company_id) and assigned_agent_id = auth.uid()));
create policy contacts_manage_company
on public.contacts for all to authenticated
using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

create policy integrations_manage_company
on public.company_integrations for all to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin())
with check (public.is_company_admin(company_id) or public.is_super_admin());
revoke all on table public.company_integration_secrets from anon, authenticated;
grant all on table public.company_integration_secrets to service_role;
create policy field_mappings_manage_company
on public.company_field_mappings for all to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin())
with check (public.is_company_admin(company_id) or public.is_super_admin());
create policy external_fields_manage_company
on public.company_external_fields for all to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin())
with check (public.is_company_admin(company_id) or public.is_super_admin());
create policy sync_runs_read_company
on public.company_sync_runs for select to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin());

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_admin_select" on public.profiles;
create policy profiles_read_company
on public.profiles for select to authenticated
using (
  id = auth.uid()
  or public.is_super_admin()
  or exists (
    select 1 from public.company_memberships target_membership
    where target_membership.profile_id = profiles.id
      and public.is_company_admin(target_membership.company_id)
  )
);

drop policy if exists "contacts_cache_select_authorized" on public.contacts_cache;
create policy contacts_cache_read_company
on public.contacts_cache for select to authenticated
using (
  public.is_company_admin(company_id)
  or (
    public.is_company_member(company_id)
    and assigned_ghl_user_id = (select p.ghl_user_id from public.profiles p where p.id = auth.uid())
    and lower(current_status) = 'open'
  )
);

drop policy if exists "work_sessions_select_own_or_admin" on public.work_sessions;
create policy work_sessions_read_company
on public.work_sessions for select to authenticated
using (
  public.is_active_app_user() and (
    agent_id = auth.uid()
    or (public.is_company_admin(company_id) and exists (
    select 1 from public.company_memberships m where m.profile_id = agent_id and m.company_id = work_sessions.company_id
    ))
  )
);

drop policy if exists "activity_logs_select_own_or_admin" on public.activity_logs;
create policy activity_logs_read_company
on public.activity_logs for select to authenticated
using (public.is_active_app_user() and (actor_id = auth.uid() or public.is_company_admin(company_id)));

drop policy if exists "calls_select_own_or_admin" on public.calls;
create policy calls_read_company
on public.calls for select to authenticated
using (
  public.is_active_app_user() and (
    agent_id = auth.uid()
    or (public.is_company_admin(company_id) and exists (
    select 1 from public.company_memberships m where m.profile_id = agent_id and m.company_id = calls.company_id
    ))
  )
);

drop policy if exists "call_dispositions_select_own_or_admin" on public.call_dispositions;
create policy call_dispositions_read_company
on public.call_dispositions for select to authenticated
using (public.is_active_app_user() and (agent_id = auth.uid() or public.is_company_admin(company_id)));

drop policy if exists "callbacks_select_own_or_admin" on public.callbacks;
create policy callbacks_read_company
on public.callbacks for select to authenticated
using (public.is_active_app_user() and (agent_id = auth.uid() or public.is_company_admin(company_id)));

drop policy if exists "contact_assignment_events_admin_read" on public.contact_assignment_events;
create policy assignment_events_read_company
on public.contact_assignment_events for select to authenticated
using (public.is_company_admin(company_id));

drop policy if exists "webhook_events_admin_select" on public.webhook_events;
create policy webhook_events_read_company
on public.webhook_events for select to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin());

drop policy if exists "audit_logs_admin_select" on public.audit_logs;
create policy audit_logs_read_company
on public.audit_logs for select to authenticated
using (public.is_company_admin(company_id) or public.is_super_admin());

create or replace function public.admin_update_company_contacts(
  p_contact_ids uuid[],
  p_set_assignment boolean,
  p_assigned_agent_id uuid,
  p_status text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
  contact_row public.contacts%rowtype;
  updated_count integer := 0;
begin
  company_id_value := public.current_company_id();
  if company_id_value is null or not public.is_company_admin(company_id_value) then
    raise exception 'active_company_admin_required';
  end if;
  if coalesce(array_length(p_contact_ids, 1), 0) < 1 or array_length(p_contact_ids, 1) > 50 then
    raise exception 'invalid_contact_selection';
  end if;
  if p_status is not null and (length(trim(p_status)) = 0 or length(trim(p_status)) > 80) then
    raise exception 'invalid_contact_status';
  end if;
  if p_set_assignment and p_assigned_agent_id is not null and not exists (
    select 1 from public.company_memberships m
    join public.profiles p on p.id = m.profile_id
    where m.profile_id = p_assigned_agent_id and m.company_id = company_id_value
      and m.role = 'agent' and m.is_active and p.is_active
  ) then
    raise exception 'invalid_company_agent';
  end if;

  for contact_row in
    select c.* from public.contacts c
    where c.id = any(p_contact_ids) and c.company_id = company_id_value
    for update
  loop
    update public.contacts c
    set assigned_agent_id = case when p_set_assignment then p_assigned_agent_id else c.assigned_agent_id end,
        status = coalesce(p_status, c.status)
    where c.id = contact_row.id;

    if p_set_assignment and contact_row.assigned_agent_id is distinct from p_assigned_agent_id then
      insert into public.contact_assignment_events (
        company_id, internal_contact_id, from_agent_id, to_agent_id, actor_id
      ) values (
        company_id_value, contact_row.id, contact_row.assigned_agent_id, p_assigned_agent_id, auth.uid()
      );
      insert into public.audit_logs (company_id, actor_id, action, target_type, target_id, metadata)
      values (company_id_value, auth.uid(), 'contact_assignment_changed', 'contact', contact_row.id::text,
        jsonb_build_object('from_agent_id', contact_row.assigned_agent_id, 'to_agent_id', p_assigned_agent_id));
    end if;
    updated_count := updated_count + 1;
  end loop;

  if updated_count <> cardinality(p_contact_ids) then
    raise exception 'company_contact_not_found';
  end if;
  return updated_count;
end;
$$;

revoke all on function public.admin_update_company_contacts(uuid[], boolean, uuid, text) from public;
grant execute on function public.admin_update_company_contacts(uuid[], boolean, uuid, text) to authenticated;

create or replace function public.admin_edit_company_contact(
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_status text,
  p_subject text,
  p_notes text,
  p_assigned_agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid := public.current_company_id();
  updated_count integer;
begin
  if company_id_value is null or not public.is_company_admin(company_id_value) then raise exception 'active_company_admin_required'; end if;
  if p_contact_id is null or p_first_name is null or p_last_name is null or p_status is null then raise exception 'invalid_contact_fields'; end if;
  if length(p_first_name) + length(p_last_name) = 0 or length(p_status) = 0 or length(p_status) > 80
    or length(coalesce(p_phone, '')) > 80 or length(coalesce(p_email, '')) > 320
    or length(coalesce(p_subject, '')) > 500 or length(coalesce(p_notes, '')) > 5000 then raise exception 'invalid_contact_fields'; end if;
  updated_count := public.admin_update_company_contacts(array[p_contact_id], true, p_assigned_agent_id, p_status);
  update public.contacts c set first_name = p_first_name, last_name = p_last_name,
    phone = nullif(p_phone, ''), email = nullif(lower(p_email), ''),
    subject = nullif(p_subject, ''), notes = nullif(p_notes, '')
  where c.id = p_contact_id and c.company_id = company_id_value;
  if not found or updated_count <> 1 then raise exception 'company_contact_not_found'; end if;
  return true;
end;
$$;

revoke all on function public.admin_edit_company_contact(uuid, text, text, text, text, text, text, text, uuid) from public;
grant execute on function public.admin_edit_company_contact(uuid, text, text, text, text, text, text, text, uuid) to authenticated;

create or replace function public.complete_callback(p_callback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid := public.current_company_id();
  caller_role public.app_role := public.current_app_role();
  callback_agent_id uuid;
begin
  if company_id_value is null or caller_role is null or not public.is_active_app_user() then return false; end if;
  select c.agent_id into callback_agent_id
  from public.callbacks c where c.id = p_callback_id and c.company_id = company_id_value;
  if callback_agent_id is null or (caller_role <> 'admin' and callback_agent_id <> auth.uid()) then return false; end if;
  update public.callbacks c set status = 'completed', completed_at = now()
  where c.id = p_callback_id and c.company_id = company_id_value and c.status in ('scheduled', 'due', 'missed');
  if not found then return false; end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, auth.uid(), 'callback_completed', 'callback', p_callback_id::text, '{}'::jsonb);
  return true;
end;
$$;

create or replace function public.reschedule_callback(p_callback_id uuid, p_due_at timestamptz, p_timezone text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid := public.current_company_id();
  caller_role public.app_role := public.current_app_role();
  callback_agent_id uuid;
begin
  if company_id_value is null or caller_role is null or not public.is_active_app_user()
    or p_due_at <= now() or not exists (select 1 from pg_timezone_names where name = p_timezone) then return false; end if;
  select c.agent_id into callback_agent_id
  from public.callbacks c where c.id = p_callback_id and c.company_id = company_id_value;
  if callback_agent_id is null or (caller_role <> 'admin' and callback_agent_id <> auth.uid()) then return false; end if;
  update public.callbacks c set due_at = p_due_at, timezone = p_timezone, status = 'scheduled', completed_at = null
  where c.id = p_callback_id and c.company_id = company_id_value and c.status in ('scheduled', 'due', 'missed');
  if not found then return false; end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, auth.uid(), 'callback_rescheduled', 'callback', p_callback_id::text, jsonb_build_object('due_at', p_due_at, 'timezone', p_timezone));
  return true;
end;
$$;

create or replace function public.start_company_agent_call(p_agent_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
  contact_row public.contacts%rowtype;
  new_call public.calls%rowtype;
begin
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies co on co.id = m.company_id
  where m.profile_id = p_agent_id and m.role = 'agent' and m.is_active and p.is_active and co.status = 'active';
  if company_id_value is null then raise exception 'active_company_agent_required'; end if;

  select c.* into contact_row
  from public.contacts c
  where c.id = p_contact_id and c.company_id = company_id_value
    and c.assigned_agent_id = p_agent_id and lower(c.status) = 'open';
  if contact_row.id is null then raise exception 'assigned_open_contact_required'; end if;

  insert into public.calls (company_id, agent_id, internal_contact_id, ghl_contact_id, current_state, requested_at, call_source)
  values (company_id_value, p_agent_id, contact_row.id, contact_row.id::text, 'requested', now(), 'agent_reported')
  returning * into new_call;

  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, p_agent_id, 'manual_call_started', 'call', new_call.id::text, jsonb_build_object('contact_id', contact_row.id));
  return jsonb_build_object('call_id', new_call.id, 'requested_at', new_call.requested_at);
end;
$$;

create or replace function public.mark_company_agent_call(
  p_agent_id uuid, p_call_id uuid, p_provider_call_id text, p_provider_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
  target_call public.calls%rowtype;
  next_state text;
begin
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies co on co.id = m.company_id
  where m.profile_id = p_agent_id and m.role = 'agent' and m.is_active and p.is_active and co.status = 'active';
  if company_id_value is null then raise exception 'active_company_agent_required'; end if;
  if p_provider_call_id is null or length(trim(p_provider_call_id)) = 0 or length(p_provider_call_id) > 255 then raise exception 'invalid_provider_call_id'; end if;
  if p_provider_state not in ('ringing', 'answered') then raise exception 'invalid_provider_call_state'; end if;

  select c.* into target_call from public.calls c
  join public.contacts ct on ct.id = c.internal_contact_id and ct.company_id = company_id_value
    and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open'
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = company_id_value
    and c.call_source = 'agent_reported' and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
  for update of c;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  if target_call.provider_call_id is not null and target_call.provider_call_id <> p_provider_call_id then raise exception 'provider_call_id_mismatch'; end if;

  next_state := case when target_call.current_state = 'answered' or p_provider_state = 'answered' then 'answered' else 'ringing' end;
  update public.calls c
  set provider_call_id = coalesce(c.provider_call_id, p_provider_call_id),
      current_state = next_state,
      ringing_at = coalesce(c.ringing_at, case when p_provider_state = 'ringing' then now() else null end),
      answered_at = coalesce(c.answered_at, case when p_provider_state = 'answered' then now() else null end)
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, p_agent_id, 'calling_provider_state', 'call', target_call.id::text, jsonb_build_object('state', next_state));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'provider_call_id', target_call.provider_call_id);
end;
$$;

create or replace function public.end_company_agent_call(p_agent_id uuid, p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
  target_call public.calls%rowtype;
  duration_seconds integer;
begin
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies co on co.id = m.company_id
  where m.profile_id = p_agent_id and m.role = 'agent' and m.is_active and p.is_active and co.status = 'active';
  if company_id_value is null then raise exception 'active_company_agent_required'; end if;

  select c.* into target_call from public.calls c
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = company_id_value
    and c.call_source = 'agent_reported' and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id and ct.company_id = company_id_value and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  duration_seconds := greatest(0, floor(extract(epoch from (now() - target_call.requested_at)))::integer);
  update public.calls c set current_state = 'completed', ended_at = now(), manual_duration_seconds = duration_seconds
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, p_agent_id, 'manual_call_ended', 'call', target_call.id::text, jsonb_build_object('manual_duration_seconds', duration_seconds));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds);
end;
$$;

create or replace function public.finish_company_agent_call(
  p_agent_id uuid, p_call_id uuid, p_outcome text, p_note text, p_callback_at timestamptz, p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
  target_call public.calls%rowtype;
  disposition_id uuid;
  new_callback_id uuid;
  duration_seconds integer;
begin
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies co on co.id = m.company_id
  where m.profile_id = p_agent_id and m.role = 'agent' and m.is_active and p.is_active and co.status = 'active';
  if company_id_value is null then raise exception 'active_company_agent_required'; end if;
  if p_outcome not in ('picked', 'not-picked', 'call-later', 'busy', 'interested') then raise exception 'invalid_call_stage'; end if;
  if p_note is not null and length(p_note) > 5000 then raise exception 'call_note_too_long'; end if;
  if p_outcome = 'call-later' and p_callback_at is null then raise exception 'callback_time_required'; end if;
  if p_outcome <> 'call-later' and p_callback_at is not null then raise exception 'callback_time_not_allowed'; end if;
  if p_callback_at is not null and (p_callback_at <= now() or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)) then raise exception 'invalid_callback_schedule'; end if;

  select c.* into target_call from public.calls c
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = company_id_value
    and c.call_source = 'agent_reported' and c.current_state = 'completed' and c.ended_at is not null
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id and ct.company_id = company_id_value and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  duration_seconds := coalesce(target_call.manual_duration_seconds, greatest(0, floor(extract(epoch from (target_call.ended_at - target_call.requested_at)))::integer));
  update public.calls c
  set answered_at = case when p_outcome in ('picked', 'interested') then coalesce(c.answered_at, c.requested_at) else c.answered_at end,
      manual_duration_seconds = duration_seconds, outcome = p_outcome, sync_state = 'not_configured'
  where c.id = target_call.id returning * into target_call;
  insert into public.call_dispositions (company_id, call_id, agent_id, outcome, note, qualified, callback_at, callback_timezone)
  values (company_id_value, target_call.id, p_agent_id, p_outcome, nullif(trim(coalesce(p_note, '')), ''), p_outcome = 'interested', p_callback_at, p_timezone)
  returning id into disposition_id;
  if p_callback_at is not null then
    insert into public.callbacks (company_id, contact_id, internal_contact_id, agent_id, due_at, timezone, status, source_call_id)
    values (company_id_value, target_call.internal_contact_id::text, target_call.internal_contact_id, p_agent_id, p_callback_at, p_timezone, 'scheduled', target_call.id)
    returning id into new_callback_id;
  end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, p_agent_id, 'manual_call_completed', 'call', target_call.id::text, jsonb_build_object('stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds, 'stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id);
end;
$$;

revoke all on function public.start_company_agent_call(uuid, uuid) from public;
revoke all on function public.mark_company_agent_call(uuid, uuid, text, text) from public;
revoke all on function public.end_company_agent_call(uuid, uuid) from public;
revoke all on function public.finish_company_agent_call(uuid, uuid, text, text, timestamptz, text) from public;
grant execute on function public.start_company_agent_call(uuid, uuid) to service_role;
grant execute on function public.mark_company_agent_call(uuid, uuid, text, text) to service_role;
grant execute on function public.end_company_agent_call(uuid, uuid) to service_role;
grant execute on function public.finish_company_agent_call(uuid, uuid, text, text, timestamptz, text) to service_role;