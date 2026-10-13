create or replace function public.mark_agent_crazytel_call(
  p_agent_id uuid,
  p_call_id uuid,
  p_provider_call_id text,
  p_provider_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  target_call public.calls%rowtype;
  next_state text;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = p_agent_id and p.is_active = true and p.app_role = 'agent';
  if caller.id is null or caller.ghl_user_id is null then raise exception 'active_mapped_agent_required'; end if;
  if p_provider_call_id is null or length(trim(p_provider_call_id)) = 0 or length(p_provider_call_id) > 255 then raise exception 'invalid_provider_call_id'; end if;
  if p_provider_state not in ('ringing', 'answered') then raise exception 'invalid_provider_call_state'; end if;

  select c.* into target_call
  from public.calls as c
  where c.id = p_call_id
    and c.agent_id = caller.id
    and c.call_source = 'agent_reported'
    and c.current_state in ('requested', 'ringing', 'answered')
    and c.ended_at is null
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;
  if target_call.provider_call_id is not null and target_call.provider_call_id <> p_provider_call_id then
    raise exception 'provider_call_id_mismatch';
  end if;

  next_state := case
    when target_call.current_state = 'answered' then 'answered'
    when p_provider_state = 'answered' then 'answered'
    else 'ringing'
  end;

  update public.calls as c
  set provider_call_id = coalesce(c.provider_call_id, p_provider_call_id),
      current_state = next_state,
      ringing_at = coalesce(c.ringing_at, case when p_provider_state = 'ringing' then now() else null end),
      answered_at = coalesce(c.answered_at, case when p_provider_state = 'answered' then now() else null end)
  where c.id = target_call.id
  returning * into target_call;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'crazytel_sip_call_state', 'call', target_call.id::text,
    jsonb_build_object('state', next_state, 'call_id_present', true));

  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state, 'provider_call_id', target_call.provider_call_id);
end;
$$;

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
    and c.current_state in ('requested', 'ringing', 'answered')
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
    jsonb_build_object('manual_duration_seconds', duration_seconds, 'provider_call_id_present', target_call.provider_call_id is not null));

  return jsonb_build_object(
    'call_id', target_call.id,
    'state', target_call.current_state,
    'ended_at', target_call.ended_at,
    'manual_duration_seconds', duration_seconds
  );
end;
$$;

create or replace function public.work_session_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  current_session public.work_sessions%rowtype;
  v_active_seconds integer;
  v_last_activity_at timestamptz;
  v_idle_duration integer;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = auth.uid() and p.is_active = true;

  if caller.id is null or caller.app_role <> 'agent' then raise exception 'active_agent_required'; end if;
  perform 1 from public.profiles as p where p.id = caller.id for update;

  if p_action = 'start' then
    if exists (select 1 from public.work_sessions as ws where ws.agent_id = caller.id and ws.state in ('active', 'paused')) then
      raise exception 'session_already_open';
    end if;
    insert into public.work_sessions (agent_id, started_at, state_changed_at, last_activity_at, state, idle_seconds, active_seconds)
    values (caller.id, now(), now(), now(), 'active', 0, 0)
    returning * into current_session;
  elsif p_action in ('pause', 'resume', 'end', 'check_idle', 'activity') then
    select ws.* into current_session from public.work_sessions as ws
    where ws.agent_id = caller.id and ws.state in ('active', 'paused')
    order by ws.started_at desc limit 1 for update;
    if current_session.id is null then return jsonb_build_object('state', 'none'); end if;

    if p_action = 'pause' and current_session.state = 'active' then
      v_active_seconds := current_session.active_seconds + greatest(0, floor(extract(epoch from (now() - coalesce(current_session.state_changed_at, current_session.started_at))))::integer);
      update public.work_sessions as ws
      set state = 'paused', state_changed_at = now(), active_seconds = v_active_seconds, reason = 'Paused by agent'
      where ws.id = current_session.id returning ws.* into current_session;
    elsif p_action = 'resume' and current_session.state = 'paused' then
      update public.work_sessions as ws
      set state = 'active', state_changed_at = now(), last_activity_at = now(), reason = null
      where ws.id = current_session.id returning ws.* into current_session;
    elsif p_action = 'end' then
      v_active_seconds := current_session.active_seconds;
      if current_session.state = 'active' then
        v_active_seconds := v_active_seconds + greatest(0, floor(extract(epoch from (now() - coalesce(current_session.state_changed_at, current_session.started_at))))::integer);
      end if;
      update public.work_sessions as ws
      set state = 'ended', ended_at = now(), state_changed_at = now(), active_seconds = v_active_seconds, reason = 'Ended by agent'
      where ws.id = current_session.id returning ws.* into current_session;
    elsif p_action = 'activity' and current_session.state = 'active' then
      update public.work_sessions as ws
      set last_activity_at = now(), reason = null
      where ws.id = current_session.id returning ws.* into current_session;
    elsif p_action = 'check_idle' and current_session.state = 'active' then
      v_last_activity_at := coalesce(current_session.last_activity_at, current_session.state_changed_at, current_session.started_at);
      if v_last_activity_at <= now() - interval '60 seconds'
        and not exists (
          select 1 from public.calls as c
          where c.agent_id = caller.id
            and c.current_state in ('requested', 'ringing', 'answered')
            and c.ended_at is null
            and (c.call_source = 'provider' or (c.call_source = 'agent_reported' and c.provider_call_id is not null))
        ) then
        v_active_seconds := current_session.active_seconds + greatest(0, floor(extract(epoch from (v_last_activity_at - coalesce(current_session.state_changed_at, current_session.started_at))))::integer);
        v_idle_duration := greatest(60, floor(extract(epoch from (now() - v_last_activity_at)))::integer);
        update public.work_sessions as ws
        set state = 'paused', state_changed_at = now(), active_seconds = v_active_seconds,
            idle_seconds = ws.idle_seconds + v_idle_duration,
            reason = 'Paused after 60 seconds without qualifying activity'
        where ws.id = current_session.id returning ws.* into current_session;
      end if;
    end if;
  else
    raise exception 'invalid_session_action';
  end if;

  return jsonb_build_object('id', current_session.id, 'state', current_session.state,
    'started_at', current_session.started_at, 'state_changed_at', current_session.state_changed_at,
    'active_seconds', current_session.active_seconds, 'idle_seconds', current_session.idle_seconds, 'reason', current_session.reason);
end;
$$;

revoke all on function public.mark_agent_crazytel_call(uuid, uuid, text, text) from public;
revoke all on function public.mark_agent_crazytel_call(uuid, uuid, text, text) from anon;
revoke all on function public.mark_agent_crazytel_call(uuid, uuid, text, text) from authenticated;
grant execute on function public.mark_agent_crazytel_call(uuid, uuid, text, text) to service_role;

revoke all on function public.end_agent_manual_call(uuid, uuid) from public;
revoke all on function public.end_agent_manual_call(uuid, uuid) from anon;
revoke all on function public.end_agent_manual_call(uuid, uuid) from authenticated;
grant execute on function public.end_agent_manual_call(uuid, uuid) to service_role;

revoke all on function public.work_session_action(text) from public;
revoke all on function public.work_session_action(text) from anon;
grant execute on function public.work_session_action(text) to authenticated;

comment on function public.mark_agent_crazytel_call(uuid, uuid, text, text) is 'Associates an authenticated agent call log with its SIP Call-ID after SIP.js sends an outbound INVITE.';
comment on function public.work_session_action(text) is 'Verified active provider calls and SIP.js calls with a recorded provider_call_id exempt idle auto-pause; unconnected demo/log records do not.';
