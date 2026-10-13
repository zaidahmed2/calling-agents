alter table public.work_sessions
  add column if not exists active_seconds integer not null default 0,
  add column if not exists state_changed_at timestamptz;

update public.work_sessions
set state_changed_at = coalesce(state_changed_at, updated_at, started_at)
where state_changed_at is null;

create or replace function public.work_session_action(p_action text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  current_session public.work_sessions%rowtype;
  active_seconds integer;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active = true;
  if caller.id is null or caller.app_role <> 'agent' then
    raise exception 'active_agent_required';
  end if;

  perform 1 from public.profiles where id = caller.id for update;

  if p_action = 'start' then
    if exists (select 1 from public.work_sessions where agent_id = caller.id and state in ('active', 'paused')) then
      raise exception 'session_already_open';
    end if;
    insert into public.work_sessions (agent_id, started_at, state_changed_at, last_activity_at, state, idle_seconds, active_seconds)
    values (caller.id, now(), now(), now(), 'active', 0, 0)
    returning * into current_session;
  elsif p_action in ('pause', 'resume', 'end', 'check_idle', 'activity') then
    select * into current_session
    from public.work_sessions
    where agent_id = caller.id and state in ('active', 'paused')
    order by started_at desc
    limit 1
    for update;

    if current_session.id is null then
      return jsonb_build_object('state', 'none');
    end if;

    if p_action = 'pause' and current_session.state = 'active' then
      active_seconds := current_session.active_seconds + greatest(0, floor(extract(epoch from (now() - current_session.state_changed_at)))::integer);
      update public.work_sessions set state = 'paused', state_changed_at = now(), active_seconds = active_seconds, reason = 'Paused by agent'
      where id = current_session.id returning * into current_session;
    elsif p_action = 'resume' and current_session.state = 'paused' then
      update public.work_sessions set state = 'active', state_changed_at = now(), last_activity_at = now(), reason = null
      where id = current_session.id returning * into current_session;
    elsif p_action = 'end' then
      active_seconds := current_session.active_seconds;
      if current_session.state = 'active' then
        active_seconds := active_seconds + greatest(0, floor(extract(epoch from (now() - current_session.state_changed_at)))::integer);
      end if;
      update public.work_sessions set state = 'ended', ended_at = now(), state_changed_at = now(), active_seconds = active_seconds, reason = 'Ended by agent'
      where id = current_session.id returning * into current_session;
    elsif p_action = 'activity' and current_session.state = 'active' then
      update public.work_sessions set last_activity_at = now(), reason = null
      where id = current_session.id returning * into current_session;
    elsif p_action = 'check_idle'
      and current_session.state = 'active'
      and coalesce(current_session.last_activity_at, current_session.state_changed_at, current_session.started_at) <= now() - interval '60 seconds'
      and not exists (
        select 1 from public.calls c
        where c.agent_id = caller.id
          and c.current_state in ('requested', 'ringing', 'answered')
          and c.ended_at is null
      ) then
      active_seconds := current_session.active_seconds + greatest(0, floor(extract(epoch from (now() - current_session.state_changed_at)))::integer);
      update public.work_sessions
      set state = 'paused', state_changed_at = now(), active_seconds = active_seconds,
          idle_seconds = idle_seconds + 60, reason = 'Paused after 60 seconds without qualifying activity'
      where id = current_session.id returning * into current_session;
    end if;
  else
    raise exception 'invalid_session_action';
  end if;

  return jsonb_build_object(
    'id', current_session.id,
    'state', current_session.state,
    'started_at', current_session.started_at,
    'state_changed_at', current_session.state_changed_at,
    'active_seconds', current_session.active_seconds,
    'idle_seconds', current_session.idle_seconds,
    'reason', current_session.reason
  );
end;
$$;

create or replace function public.audit_agent_phone_reveal(p_contact_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
begin
  select * into caller from public.profiles where id = auth.uid() and is_active = true and app_role = 'agent';
  if caller.id is null or p_contact_id is null or length(p_contact_id) > 100 then
    return false;
  end if;
  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'agent_phone_revealed', 'contact', p_contact_id, '{}'::jsonb);
  return true;
end;
$$;

revoke all on function public.work_session_action(text) from public;
revoke all on function public.audit_agent_phone_reveal(text) from public;
grant execute on function public.work_session_action(text) to authenticated;
grant execute on function public.audit_agent_phone_reveal(text) to authenticated;

comment on function public.work_session_action(text) is 'Server-timestamped agent timer controls. check_idle pauses after 60 seconds without qualifying activity unless a stored call is active.';
comment on function public.audit_agent_phone_reveal(text) is 'Audits agent phone reveals without storing the phone number.';
