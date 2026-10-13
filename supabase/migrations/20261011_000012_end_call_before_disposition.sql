create or replace function public.end_agent_manual_call(
  p_agent_id uuid,
  p_call_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  target_call public.calls%rowtype;
  duration_seconds integer;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = p_agent_id and p.is_active = true and p.app_role = 'agent';
  if caller.id is null or caller.ghl_user_id is null then raise exception 'active_mapped_agent_required'; end if;

  select c.* into target_call
  from public.calls as c
  where c.id = p_call_id
    and c.agent_id = caller.id
    and c.call_source = 'agent_reported'
    and c.current_state = 'requested'
    and c.ended_at is null
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  duration_seconds := greatest(0, floor(extract(epoch from (now() - target_call.requested_at)))::integer);
  update public.calls as c
  set current_state = 'completed',
      ended_at = now(),
      manual_duration_seconds = duration_seconds
  where c.id = target_call.id
  returning * into target_call;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'manual_call_ended', 'call', target_call.id::text,
    jsonb_build_object('manual_duration_seconds', duration_seconds));

  return jsonb_build_object(
    'call_id', target_call.id,
    'state', target_call.current_state,
    'ended_at', target_call.ended_at,
    'manual_duration_seconds', duration_seconds
  );
end;
$$;

create or replace function public.finish_agent_manual_call(
  p_agent_id uuid,
  p_call_id uuid,
  p_outcome text,
  p_note text,
  p_callback_at timestamptz,
  p_timezone text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  target_call public.calls%rowtype;
  disposition_id uuid;
  new_callback_id uuid;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = p_agent_id and p.is_active = true and p.app_role = 'agent';
  if caller.id is null or caller.ghl_user_id is null then raise exception 'active_mapped_agent_required'; end if;

  if p_outcome not in ('picked', 'not-picked', 'call-later', 'busy', 'interested') then
    raise exception 'invalid_call_stage';
  end if;
  if p_note is not null and length(p_note) > 5000 then raise exception 'call_note_too_long'; end if;
  if p_outcome = 'call-later' and p_callback_at is null then raise exception 'callback_time_required'; end if;
  if p_outcome <> 'call-later' and p_callback_at is not null then raise exception 'callback_time_not_allowed'; end if;
  if p_callback_at is not null and (p_callback_at <= now() or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)) then
    raise exception 'invalid_callback_schedule';
  end if;

  select c.* into target_call
  from public.calls as c
  where c.id = p_call_id
    and c.agent_id = caller.id
    and c.call_source = 'agent_reported'
    and c.current_state = 'completed'
    and c.ended_at is not null
    and not exists (select 1 from public.call_dispositions as cd where cd.call_id = c.id)
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  update public.calls as c
  set answered_at = case when p_outcome in ('picked', 'interested') then coalesce(c.answered_at, c.requested_at) else c.answered_at end,
      outcome = p_outcome,
      sync_state = 'pending'
  where c.id = target_call.id
  returning * into target_call;

  insert into public.call_dispositions (call_id, agent_id, outcome, note, qualified, callback_at, callback_timezone)
  values (target_call.id, caller.id, p_outcome, nullif(trim(coalesce(p_note, '')), ''), p_outcome = 'interested', p_callback_at, p_timezone)
  returning id into disposition_id;

  if p_callback_at is not null then
    insert into public.callbacks (contact_id, agent_id, due_at, timezone, status, source_call_id)
    values (target_call.ghl_contact_id, caller.id, p_callback_at, p_timezone, 'scheduled', target_call.id)
    returning id into new_callback_id;
  end if;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'manual_call_completed', 'call', target_call.id::text,
    jsonb_build_object('stage', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id));

  return jsonb_build_object(
    'call_id', target_call.id,
    'state', target_call.current_state,
    'ended_at', target_call.ended_at,
    'manual_duration_seconds', target_call.manual_duration_seconds,
    'stage', p_outcome,
    'disposition_id', disposition_id,
    'callback_id', new_callback_id
  );
end;
$$;

revoke all on function public.end_agent_manual_call(uuid, uuid) from public;
revoke all on function public.end_agent_manual_call(uuid, uuid) from anon;
revoke all on function public.end_agent_manual_call(uuid, uuid) from authenticated;
grant execute on function public.end_agent_manual_call(uuid, uuid) to service_role;

revoke all on function public.finish_agent_manual_call(uuid, uuid, text, text, timestamptz, text) from public;
revoke all on function public.finish_agent_manual_call(uuid, uuid, text, text, timestamptz, text) from anon;
revoke all on function public.finish_agent_manual_call(uuid, uuid, text, text, timestamptz, text) from authenticated;
grant execute on function public.finish_agent_manual_call(uuid, uuid, text, text, timestamptz, text) to service_role;

comment on function public.end_agent_manual_call(uuid, uuid) is 'Ends an agent-reported call using server time before the agent enters a call disposition.';
comment on function public.finish_agent_manual_call(uuid, uuid, text, text, timestamptz, text) is 'Saves the stage, message, and optional callback for an already ended agent-reported call.';
