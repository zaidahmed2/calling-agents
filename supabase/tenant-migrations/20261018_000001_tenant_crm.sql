create extension if not exists pgcrypto;
create extension if not exists citext;

create table public.tenant_schema_migrations (
  version text primary key,
  applied_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  email citext,
  status text not null default 'open',
  subject text,
  notes text,
  lead_source text,
  assigned_agent_id uuid,
  custom_fields jsonb not null default '{}'::jsonb check (jsonb_typeof(custom_fields) = 'object'),
  external_provider text,
  external_contact_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (length(first_name) + length(last_name) > 0),
  check (external_provider is null or external_provider = 'ghl'),
  unique (company_id, external_provider, external_contact_id)
);

create index contacts_company_status on public.contacts (company_id, lower(status));
create index contacts_assigned_agent on public.contacts (company_id, assigned_agent_id);
create index contacts_company_email on public.contacts (company_id, email);

create table public.contact_assignment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  internal_contact_id uuid references public.contacts(id) on delete set null,
  ghl_contact_id text,
  from_agent_id uuid,
  to_agent_id uuid,
  from_ghl_user_id text,
  to_ghl_user_id text,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  check (
    (internal_contact_id is not null and from_agent_id is distinct from to_agent_id)
    or (internal_contact_id is null and ghl_contact_id is not null and from_ghl_user_id is distinct from to_ghl_user_id)
    or (internal_contact_id is null and ghl_contact_id is null)
  )
);

create index contact_assignment_events_contact on public.contact_assignment_events (company_id, internal_contact_id, created_at desc);
create index contact_assignment_events_target on public.contact_assignment_events (company_id, to_agent_id, created_at desc);
create index contact_assignment_events_actor on public.contact_assignment_events (company_id, actor_id, created_at desc);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider_call_id text unique,
  agent_id uuid not null,
  ghl_contact_id text not null,
  internal_contact_id uuid references public.contacts(id) on delete set null,
  current_state text not null default 'requested'
    check (current_state in ('requested', 'ringing', 'answered', 'completed', 'failed', 'cancelled')),
  requested_at timestamptz not null default now(),
  ringing_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  verified_duration_seconds integer,
  manual_duration_seconds integer,
  call_source text not null default 'provider' check (call_source in ('provider', 'agent_reported')),
  outcome text,
  recording_reference text,
  sync_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index calls_company_agent on public.calls (company_id, agent_id, requested_at desc);
create index calls_company_contact on public.calls (company_id, internal_contact_id, requested_at desc);
create index calls_state on public.calls (company_id, current_state);
create index calls_source_requested on public.calls (call_source, requested_at desc);

create table public.call_dispositions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  call_id uuid not null references public.calls(id) on delete cascade,
  agent_id uuid not null,
  outcome text not null,
  note text,
  qualified boolean not null default false,
  callback_at timestamptz,
  callback_timezone text,
  created_at timestamptz not null default now()
);

create index call_dispositions_company_call on public.call_dispositions (company_id, call_id, created_at desc);
create index call_dispositions_company_agent on public.call_dispositions (company_id, agent_id);
create index call_dispositions_callback_at on public.call_dispositions (company_id, callback_at);

create table public.callbacks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  contact_id text not null,
  internal_contact_id uuid references public.contacts(id) on delete set null,
  agent_id uuid not null,
  due_at timestamptz not null,
  timezone text not null default 'UTC',
  status text not null default 'scheduled'
    check (status in ('scheduled', 'due', 'completed', 'missed', 'cancelled')),
  source_call_id uuid references public.calls(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index callbacks_company_agent on public.callbacks (company_id, agent_id, due_at);
create index callbacks_company_due on public.callbacks (company_id, due_at);
create index callbacks_status on public.callbacks (company_id, status);

create table public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_id uuid,
  event_type text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index activity_logs_company_actor on public.activity_logs (company_id, actor_id, created_at desc);
create index activity_logs_company_event on public.activity_logs (company_id, event_type, created_at desc);

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_logs_company_actor on public.audit_logs (company_id, actor_id, created_at desc);
create index audit_logs_company_action on public.audit_logs (company_id, action, created_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_contacts_updated_at before update on public.contacts
for each row execute function public.set_updated_at();
create trigger trg_calls_updated_at before update on public.calls
for each row execute function public.set_updated_at();
create trigger trg_callbacks_updated_at before update on public.callbacks
for each row execute function public.set_updated_at();

create or replace function public.admin_update_company_contacts(
  p_company_id uuid,
  p_contact_ids uuid[],
  p_set_assignment boolean,
  p_assigned_agent_id uuid,
  p_status text,
  p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  contact_row public.contacts%rowtype;
  updated_count integer := 0;
begin
  if p_company_id is null or p_actor_id is null
    or coalesce(array_length(p_contact_ids, 1), 0) < 1
    or array_length(p_contact_ids, 1) > 50 then
    raise exception 'invalid_contact_selection';
  end if;
  if p_status is not null and (length(trim(p_status)) = 0 or length(trim(p_status)) > 80) then
    raise exception 'invalid_contact_status';
  end if;

  for contact_row in
    select c.* from public.contacts c
    where c.id = any(p_contact_ids) and c.company_id = p_company_id
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
        p_company_id, contact_row.id, contact_row.assigned_agent_id, p_assigned_agent_id, p_actor_id
      );
      insert into public.audit_logs (company_id, actor_id, action, target_type, target_id, metadata)
      values (p_company_id, p_actor_id, 'contact_assignment_changed', 'contact', contact_row.id::text,
        jsonb_build_object('from_agent_id', contact_row.assigned_agent_id, 'to_agent_id', p_assigned_agent_id));
    end if;
    updated_count := updated_count + 1;
  end loop;

  if updated_count <> cardinality(p_contact_ids) then raise exception 'company_contact_not_found'; end if;
  return updated_count;
end;
$$;

create or replace function public.admin_edit_company_contact(
  p_company_id uuid,
  p_contact_id uuid,
  p_first_name text,
  p_last_name text,
  p_phone text,
  p_email text,
  p_status text,
  p_subject text,
  p_notes text,
  p_assigned_agent_id uuid,
  p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if p_contact_id is null or p_first_name is null or p_last_name is null or p_status is null then
    raise exception 'invalid_contact_fields';
  end if;
  if length(p_first_name) + length(p_last_name) = 0 or length(p_status) = 0 or length(p_status) > 80
    or length(coalesce(p_phone, '')) > 80 or length(coalesce(p_email, '')) > 320
    or length(coalesce(p_subject, '')) > 500 or length(coalesce(p_notes, '')) > 5000 then
    raise exception 'invalid_contact_fields';
  end if;
  updated_count := public.admin_update_company_contacts(
    p_company_id, array[p_contact_id], true, p_assigned_agent_id, p_status, p_actor_id
  );
  update public.contacts c set first_name = p_first_name, last_name = p_last_name,
    phone = nullif(p_phone, ''), email = nullif(lower(p_email), ''),
    subject = nullif(p_subject, ''), notes = nullif(p_notes, '')
  where c.id = p_contact_id and c.company_id = p_company_id;
  if not found or updated_count <> 1 then raise exception 'company_contact_not_found'; end if;
  return true;
end;
$$;

create or replace function public.start_company_agent_call(p_company_id uuid, p_agent_id uuid, p_contact_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contact_row public.contacts%rowtype;
  new_call public.calls%rowtype;
begin
  select c.* into contact_row from public.contacts c
  where c.id = p_contact_id and c.company_id = p_company_id
    and c.assigned_agent_id = p_agent_id and lower(c.status) = 'open';
  if contact_row.id is null then raise exception 'assigned_open_contact_required'; end if;

  insert into public.calls (company_id, agent_id, internal_contact_id, ghl_contact_id, current_state, requested_at, call_source)
  values (p_company_id, p_agent_id, contact_row.id, contact_row.id::text, 'requested', now(), 'agent_reported')
  returning * into new_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_started', 'call', new_call.id::text, jsonb_build_object('contact_id', contact_row.id));
  return jsonb_build_object('call_id', new_call.id, 'requested_at', new_call.requested_at);
end;
$$;

create or replace function public.mark_company_agent_call(
  p_company_id uuid, p_agent_id uuid, p_call_id uuid, p_provider_call_id text, p_provider_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_call public.calls%rowtype;
  next_state text;
begin
  if p_provider_call_id is null or length(trim(p_provider_call_id)) = 0 or length(p_provider_call_id) > 255
    or p_provider_state not in ('ringing', 'answered') then raise exception 'invalid_provider_call_state'; end if;
  select c.* into target_call from public.calls c
  join public.contacts ct on ct.id = c.internal_contact_id and ct.company_id = p_company_id
    and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open'
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = p_company_id
    and c.call_source = 'agent_reported' and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
  for update of c;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  if target_call.provider_call_id is not null and target_call.provider_call_id <> p_provider_call_id then raise exception 'provider_call_id_mismatch'; end if;
  next_state := case when target_call.current_state = 'answered' or p_provider_state = 'answered' then 'answered' else 'ringing' end;
  update public.calls c set provider_call_id = coalesce(c.provider_call_id, p_provider_call_id),
    current_state = next_state,
    ringing_at = coalesce(c.ringing_at, case when p_provider_state = 'ringing' then now() else null end),
    answered_at = coalesce(c.answered_at, case when p_provider_state = 'answered' then now() else null end)
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'calling_provider_state', 'call', target_call.id::text, jsonb_build_object('state', next_state));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'provider_call_id', target_call.provider_call_id);
end;
$$;

create or replace function public.end_company_agent_call(p_company_id uuid, p_agent_id uuid, p_call_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_call public.calls%rowtype;
  duration_seconds integer;
begin
  select c.* into target_call from public.calls c
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = p_company_id
    and c.call_source = 'agent_reported' and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id
      and ct.company_id = p_company_id and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  duration_seconds := case when target_call.answered_at is null then 0
    else greatest(0, floor(extract(epoch from (now() - target_call.answered_at)))::integer) end;
  update public.calls c set current_state = 'completed', ended_at = now(), manual_duration_seconds = duration_seconds
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_ended', 'call', target_call.id::text,
    jsonb_build_object('manual_duration_seconds', duration_seconds));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state,
    'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds);
end;
$$;

create or replace function public.finish_company_agent_call(
  p_company_id uuid, p_agent_id uuid, p_call_id uuid, p_outcome text, p_note text,
  p_callback_at timestamptz, p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target_call public.calls%rowtype;
  disposition_id uuid;
  new_callback_id uuid;
  duration_seconds integer;
begin
  if p_outcome not in ('picked', 'not-picked', 'call-later', 'busy', 'interested') then raise exception 'invalid_call_stage'; end if;
  if p_note is not null and length(p_note) > 5000 then raise exception 'call_note_too_long'; end if;
  if p_outcome = 'call-later' and p_callback_at is null then raise exception 'callback_time_required'; end if;
  if p_outcome <> 'call-later' and p_callback_at is not null then raise exception 'callback_time_not_allowed'; end if;
  if p_callback_at is not null and (p_callback_at <= now() or p_timezone is null
    or not exists (select 1 from pg_timezone_names where name = p_timezone)) then raise exception 'invalid_callback_schedule'; end if;
  select c.* into target_call from public.calls c
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = p_company_id
    and c.call_source = 'agent_reported' and c.current_state = 'completed' and c.ended_at is not null
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id
      and ct.company_id = p_company_id and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  duration_seconds := coalesce(target_call.manual_duration_seconds,
    greatest(0, floor(extract(epoch from (target_call.ended_at - target_call.requested_at)))::integer));
  update public.calls c set answered_at = case when p_outcome in ('picked', 'interested')
      then coalesce(c.answered_at, c.requested_at) else c.answered_at end,
    manual_duration_seconds = duration_seconds, outcome = p_outcome, sync_state = 'not_configured'
  where c.id = target_call.id returning * into target_call;
  insert into public.call_dispositions (company_id, call_id, agent_id, outcome, note, qualified, callback_at, callback_timezone)
  values (p_company_id, target_call.id, p_agent_id, p_outcome,
    nullif(trim(coalesce(p_note, '')), ''), p_outcome = 'interested', p_callback_at, p_timezone)
  returning id into disposition_id;
  if p_callback_at is not null then
    insert into public.callbacks (company_id, contact_id, internal_contact_id, agent_id, due_at, timezone, status, source_call_id)
    values (p_company_id, target_call.internal_contact_id::text, target_call.internal_contact_id,
      p_agent_id, p_callback_at, p_timezone, 'scheduled', target_call.id)
    returning id into new_callback_id;
  end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_completed', 'call', target_call.id::text,
    jsonb_build_object('stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state,
    'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds,
    'stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id);
end;
$$;

create or replace function public.complete_callback(
  p_company_id uuid, p_callback_id uuid, p_actor_id uuid, p_is_admin boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  callback_agent_id uuid;
begin
  select c.agent_id into callback_agent_id from public.callbacks c
  where c.id = p_callback_id and c.company_id = p_company_id;
  if callback_agent_id is null or (not p_is_admin and callback_agent_id <> p_actor_id) then return false; end if;
  update public.callbacks c set status = 'completed', completed_at = now()
  where c.id = p_callback_id and c.company_id = p_company_id and c.status in ('scheduled', 'due', 'missed');
  if not found then return false; end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id)
  values (p_company_id, p_actor_id, 'callback_completed', 'callback', p_callback_id::text);
  return true;
end;
$$;

create or replace function public.reschedule_callback(
  p_company_id uuid, p_callback_id uuid, p_actor_id uuid, p_is_admin boolean,
  p_due_at timestamptz, p_timezone text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  callback_agent_id uuid;
begin
  if p_due_at <= now() or not exists (select 1 from pg_timezone_names where name = p_timezone) then return false; end if;
  select c.agent_id into callback_agent_id from public.callbacks c
  where c.id = p_callback_id and c.company_id = p_company_id;
  if callback_agent_id is null or (not p_is_admin and callback_agent_id <> p_actor_id) then return false; end if;
  update public.callbacks c set due_at = p_due_at, timezone = p_timezone, status = 'scheduled', completed_at = null
  where c.id = p_callback_id and c.company_id = p_company_id and c.status in ('scheduled', 'due', 'missed');
  if not found then return false; end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_actor_id, 'callback_rescheduled', 'callback', p_callback_id::text,
    jsonb_build_object('due_at', p_due_at, 'timezone', p_timezone));
  return true;
end;
$$;

create or replace function public.audit_agent_phone_reveal(p_company_id uuid, p_actor_id uuid, p_contact_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.contacts c where c.id = p_contact_id
    and c.company_id = p_company_id and c.assigned_agent_id = p_actor_id and lower(c.status) = 'open') then
    return false;
  end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id)
  values (p_company_id, p_actor_id, 'agent_phone_revealed', 'contact', p_contact_id::text);
  return true;
end;
$$;

revoke all on function public.admin_update_company_contacts(uuid, uuid[], boolean, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.admin_edit_company_contact(uuid, uuid, text, text, text, text, text, text, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.start_company_agent_call(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_company_agent_call(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.end_company_agent_call(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_company_agent_call(uuid, uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.complete_callback(uuid, uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.reschedule_callback(uuid, uuid, uuid, boolean, timestamptz, text) from public, anon, authenticated;
revoke all on function public.audit_agent_phone_reveal(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_update_company_contacts(uuid, uuid[], boolean, uuid, text, uuid) to service_role;
grant execute on function public.admin_edit_company_contact(uuid, uuid, text, text, text, text, text, text, text, uuid, uuid) to service_role;
grant execute on function public.start_company_agent_call(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_company_agent_call(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.end_company_agent_call(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_company_agent_call(uuid, uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.complete_callback(uuid, uuid, uuid, boolean) to service_role;
grant execute on function public.reschedule_callback(uuid, uuid, uuid, boolean, timestamptz, text) to service_role;
grant execute on function public.audit_agent_phone_reveal(uuid, uuid, uuid) to service_role;

alter table public.tenant_schema_migrations enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_assignment_events enable row level security;
alter table public.calls enable row level security;
alter table public.call_dispositions enable row level security;
alter table public.callbacks enable row level security;
alter table public.activity_logs enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

insert into public.tenant_schema_migrations (version)
values ('20261021_000002');
