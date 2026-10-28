export const tenantMigrations = [{
  version: "20261021_000002",
  sql: `create or replace function public.end_company_agent_call(p_company_id uuid, p_agent_id uuid, p_call_id uuid)
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
$$`,
}, {
  version: "20261029_000003",
  sql: `alter table public.contacts
  add column if not exists assigned_agent_ids uuid[] not null default '{}'::uuid[];

update public.contacts
set assigned_agent_ids = array[assigned_agent_id]
where assigned_agent_id is not null and cardinality(assigned_agent_ids) = 0;

create index if not exists contacts_company_assigned_agents
  on public.contacts using gin (assigned_agent_ids);

create or replace function public.sync_contact_assignment_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.assigned_agent_ids is null then new.assigned_agent_ids := '{}'::uuid[]; end if;
  if tg_op = 'INSERT' and cardinality(new.assigned_agent_ids) = 0 and new.assigned_agent_id is not null then
    new.assigned_agent_ids := array[new.assigned_agent_id];
  elsif tg_op = 'UPDATE' and new.assigned_agent_ids is not distinct from old.assigned_agent_ids
    and new.assigned_agent_id is distinct from old.assigned_agent_id then
    new.assigned_agent_ids := case when new.assigned_agent_id is null then '{}'::uuid[] else array[new.assigned_agent_id] end;
  end if;
  new.assigned_agent_id := new.assigned_agent_ids[1];
  return new;
end;
$$;

drop trigger if exists trg_contacts_sync_assignment_columns on public.contacts;
create trigger trg_contacts_sync_assignment_columns
before insert or update of assigned_agent_id, assigned_agent_ids on public.contacts
for each row execute function public.sync_contact_assignment_columns();

create or replace function public.contact_is_assigned_to_agent(p_contact_id uuid, p_company_id uuid, p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contacts c
    where c.id = p_contact_id and c.company_id = p_company_id
      and (p_agent_id = any(coalesce(c.assigned_agent_ids, '{}'::uuid[])) or c.assigned_agent_id = p_agent_id)
  );
$$;

revoke all on function public.contact_is_assigned_to_agent(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.contact_is_assigned_to_agent(uuid, uuid, uuid) to service_role;

create or replace function public.admin_assign_company_contacts(
  p_company_id uuid, p_contact_ids uuid[], p_set_assignment boolean,
  p_assigned_agent_ids uuid[], p_status text, p_actor_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  contact_row public.contacts%rowtype;
  agent_ids uuid[] := coalesce(p_assigned_agent_ids, '{}'::uuid[]);
  changed_agent_id uuid;
  updated_count integer := 0;
begin
  if p_company_id is null or p_actor_id is null or coalesce(array_length(p_contact_ids, 1), 0) < 1
    or array_length(p_contact_ids, 1) > 50 then raise exception 'invalid_contact_selection'; end if;
  if p_status is not null and (length(trim(p_status)) = 0 or length(trim(p_status)) > 80) then raise exception 'invalid_contact_status'; end if;
  if cardinality(agent_ids) > 100 or cardinality(agent_ids) <> (
    select count(distinct selected.profile_id) from unnest(agent_ids) as selected(profile_id)
  ) then
    raise exception 'invalid_company_agent';
  end if;
  for contact_row in
    select c.* from public.contacts c where c.id = any(p_contact_ids) and c.company_id = p_company_id for update
  loop
    if p_set_assignment then
      update public.contacts c set assigned_agent_ids = agent_ids, assigned_agent_id = agent_ids[1],
        status = coalesce(p_status, c.status) where c.id = contact_row.id;
      for changed_agent_id in
        select previous.profile_id from unnest(coalesce(contact_row.assigned_agent_ids, '{}'::uuid[])) as previous(profile_id)
        where not previous.profile_id = any(agent_ids)
      loop
        insert into public.contact_assignment_events (company_id, internal_contact_id, from_agent_id, to_agent_id, actor_id)
        values (p_company_id, contact_row.id, changed_agent_id, null, p_actor_id);
      end loop;
      for changed_agent_id in
        select next_agent.profile_id from unnest(agent_ids) as next_agent(profile_id)
        where not next_agent.profile_id = any(coalesce(contact_row.assigned_agent_ids, '{}'::uuid[]))
      loop
        insert into public.contact_assignment_events (company_id, internal_contact_id, from_agent_id, to_agent_id, actor_id)
        values (p_company_id, contact_row.id, null, changed_agent_id, p_actor_id);
      end loop;
      if contact_row.assigned_agent_ids is distinct from agent_ids then
        insert into public.audit_logs (company_id, actor_id, action, target_type, target_id, metadata)
        values (p_company_id, p_actor_id, 'contact_assignment_changed', 'contact', contact_row.id::text,
          jsonb_build_object('from_agent_ids', contact_row.assigned_agent_ids, 'to_agent_ids', agent_ids));
      end if;
    else
      update public.contacts c set status = coalesce(p_status, c.status) where c.id = contact_row.id;
    end if;
    updated_count := updated_count + 1;
  end loop;
  if updated_count <> cardinality(p_contact_ids) then raise exception 'company_contact_not_found'; end if;
  return updated_count;
end;
$$;

create or replace function public.admin_edit_company_contact_multi(
  p_company_id uuid, p_contact_id uuid, p_first_name text, p_last_name text,
  p_phone text, p_email text, p_status text, p_subject text, p_notes text,
  p_assigned_agent_ids uuid[], p_actor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  updated_count integer;
begin
  if p_contact_id is null or p_actor_id is null or p_first_name is null or p_last_name is null or p_status is null
    or length(p_first_name) + length(p_last_name) = 0 or length(p_status) = 0 or length(p_status) > 80
    or length(coalesce(p_phone, '')) > 80 or length(coalesce(p_email, '')) > 320
    or length(coalesce(p_subject, '')) > 500 or length(coalesce(p_notes, '')) > 5000 then raise exception 'invalid_contact_fields'; end if;
  updated_count := public.admin_assign_company_contacts(p_company_id, array[p_contact_id], true, p_assigned_agent_ids, p_status, p_actor_id);
  update public.contacts c set first_name = p_first_name, last_name = p_last_name,
    phone = nullif(p_phone, ''), email = nullif(lower(p_email), ''),
    subject = nullif(p_subject, ''), notes = nullif(p_notes, '')
  where c.id = p_contact_id and c.company_id = p_company_id;
  if not found or updated_count <> 1 then raise exception 'company_contact_not_found'; end if;
  return true;
end;
$$;

create or replace function public.start_company_agent_call(p_company_id uuid, p_agent_id uuid, p_contact_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare contact_row public.contacts%rowtype; new_call public.calls%rowtype;
begin
  select c.* into contact_row from public.contacts c where c.id = p_contact_id and c.company_id = p_company_id
    and lower(c.status) = 'open' and public.contact_is_assigned_to_agent(c.id, p_company_id, p_agent_id);
  if contact_row.id is null then raise exception 'assigned_open_contact_required'; end if;
  insert into public.calls (company_id, agent_id, internal_contact_id, ghl_contact_id, current_state, requested_at, call_source)
  values (p_company_id, p_agent_id, contact_row.id, contact_row.id::text, 'requested', now(), 'agent_reported') returning * into new_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_started', 'call', new_call.id::text, jsonb_build_object('contact_id', contact_row.id));
  return jsonb_build_object('call_id', new_call.id, 'requested_at', new_call.requested_at);
end;
$$;

create or replace function public.mark_company_agent_call(
  p_company_id uuid, p_agent_id uuid, p_call_id uuid, p_provider_call_id text, p_provider_state text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_call public.calls%rowtype; next_state text;
begin
  if p_provider_call_id is null or length(trim(p_provider_call_id)) = 0 or length(p_provider_call_id) > 255
    or p_provider_state not in ('ringing', 'answered') then raise exception 'invalid_provider_call_state'; end if;
  select c.* into target_call from public.calls c join public.contacts ct on ct.id = c.internal_contact_id
    and ct.company_id = p_company_id and lower(ct.status) = 'open'
    and public.contact_is_assigned_to_agent(ct.id, p_company_id, p_agent_id)
  where c.id = p_call_id and c.agent_id = p_agent_id and c.company_id = p_company_id
    and c.call_source = 'agent_reported' and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
  for update of c;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  if target_call.provider_call_id is not null and target_call.provider_call_id <> p_provider_call_id then raise exception 'provider_call_id_mismatch'; end if;
  next_state := case when target_call.current_state = 'answered' or p_provider_state = 'answered' then 'answered' else 'ringing' end;
  update public.calls c set provider_call_id = coalesce(c.provider_call_id, p_provider_call_id), current_state = next_state,
    ringing_at = coalesce(c.ringing_at, case when p_provider_state = 'ringing' then now() else null end),
    answered_at = coalesce(c.answered_at, case when p_provider_state = 'answered' then now() else null end)
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'calling_provider_state', 'call', target_call.id::text, jsonb_build_object('state', next_state));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'provider_call_id', target_call.provider_call_id);
end;
$$;

create or replace function public.end_company_agent_call(p_company_id uuid, p_agent_id uuid, p_call_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_call public.calls%rowtype; duration_seconds integer;
begin
  select c.* into target_call from public.calls c where c.id = p_call_id and c.agent_id = p_agent_id
    and c.company_id = p_company_id and c.call_source = 'agent_reported'
    and c.current_state in ('requested', 'ringing', 'answered') and c.ended_at is null
    and public.contact_is_assigned_to_agent(c.internal_contact_id, p_company_id, p_agent_id)
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id and ct.company_id = p_company_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  duration_seconds := case when target_call.answered_at is null then 0 else greatest(0, floor(extract(epoch from (now() - target_call.answered_at)))::integer) end;
  update public.calls c set current_state = 'completed', ended_at = now(), manual_duration_seconds = duration_seconds
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_ended', 'call', target_call.id::text, jsonb_build_object('manual_duration_seconds', duration_seconds));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds);
end;
$$;

create or replace function public.finish_company_agent_call(
  p_company_id uuid, p_agent_id uuid, p_call_id uuid, p_outcome text, p_note text,
  p_callback_at timestamptz, p_timezone text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare target_call public.calls%rowtype; disposition_id uuid; new_callback_id uuid; duration_seconds integer;
begin
  if p_outcome not in ('picked', 'not-picked', 'call-later', 'busy', 'interested') then raise exception 'invalid_call_stage'; end if;
  if p_note is not null and length(p_note) > 5000 then raise exception 'call_note_too_long'; end if;
  if p_outcome = 'call-later' and p_callback_at is null then raise exception 'callback_time_required'; end if;
  if p_outcome <> 'call-later' and p_callback_at is not null then raise exception 'callback_time_not_allowed'; end if;
  if p_callback_at is not null and (p_callback_at <= now() or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)) then raise exception 'invalid_callback_schedule'; end if;
  select c.* into target_call from public.calls c where c.id = p_call_id and c.agent_id = p_agent_id
    and c.company_id = p_company_id and c.call_source = 'agent_reported' and c.current_state = 'completed' and c.ended_at is not null
    and public.contact_is_assigned_to_agent(c.internal_contact_id, p_company_id, p_agent_id)
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id and ct.company_id = p_company_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  duration_seconds := coalesce(target_call.manual_duration_seconds, greatest(0, floor(extract(epoch from (target_call.ended_at - target_call.requested_at)))::integer));
  update public.calls c set answered_at = case when p_outcome in ('picked', 'interested') then coalesce(c.answered_at, c.requested_at) else c.answered_at end,
    manual_duration_seconds = duration_seconds, outcome = p_outcome, sync_state = 'not_configured'
  where c.id = target_call.id returning * into target_call;
  insert into public.call_dispositions (company_id, call_id, agent_id, outcome, note, qualified, callback_at, callback_timezone)
  values (p_company_id, target_call.id, p_agent_id, p_outcome, nullif(trim(coalesce(p_note, '')), ''), p_outcome = 'interested', p_callback_at, p_timezone)
  returning id into disposition_id;
  if p_callback_at is not null then
    insert into public.callbacks (company_id, contact_id, internal_contact_id, agent_id, due_at, timezone, status, source_call_id)
    values (p_company_id, target_call.internal_contact_id::text, target_call.internal_contact_id, p_agent_id, p_callback_at, p_timezone, 'scheduled', target_call.id)
    returning id into new_callback_id;
  end if;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (p_company_id, p_agent_id, 'manual_call_completed', 'call', target_call.id::text,
    jsonb_build_object('stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'ended_at', target_call.ended_at,
    'manual_duration_seconds', duration_seconds, 'stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id);
end;
$$;

revoke all on function public.admin_assign_company_contacts(uuid, uuid[], boolean, uuid[], text, uuid) from public, anon, authenticated;
revoke all on function public.admin_edit_company_contact_multi(uuid, uuid, text, text, text, text, text, text, text, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.admin_assign_company_contacts(uuid, uuid[], boolean, uuid[], text, uuid) to service_role;
grant execute on function public.admin_edit_company_contact_multi(uuid, uuid, text, text, text, text, text, text, text, uuid[], uuid) to service_role;

revoke all on function public.start_company_agent_call(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.mark_company_agent_call(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.end_company_agent_call(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.finish_company_agent_call(uuid, uuid, uuid, text, text, timestamptz, text) from public, anon, authenticated;
grant execute on function public.start_company_agent_call(uuid, uuid, uuid) to service_role;
grant execute on function public.mark_company_agent_call(uuid, uuid, uuid, text, text) to service_role;
grant execute on function public.end_company_agent_call(uuid, uuid, uuid) to service_role;
grant execute on function public.finish_company_agent_call(uuid, uuid, uuid, text, text, timestamptz, text) to service_role;`,
}] as const;
