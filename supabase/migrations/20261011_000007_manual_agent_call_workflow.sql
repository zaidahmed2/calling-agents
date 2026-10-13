alter table public.calls
  add column if not exists call_source text not null default 'provider',
  add column if not exists manual_duration_seconds integer;

alter table public.calls
  drop constraint if exists calls_call_source_check;

alter table public.calls
  add constraint calls_call_source_check check (call_source in ('provider', 'agent_reported'));

create index if not exists idx_calls_source_requested on public.calls (call_source, requested_at desc);

create or replace function public.start_agent_manual_call(p_contact_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  new_call public.calls%rowtype;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = auth.uid() and p.is_active = true and p.app_role = 'agent';

  if caller.id is null or caller.ghl_user_id is null then
    raise exception 'active_mapped_agent_required';
  end if;
  if p_contact_id is null or length(trim(p_contact_id)) = 0 or length(p_contact_id) > 100 then
    raise exception 'invalid_contact_id';
  end if;

  insert into public.calls (agent_id, ghl_contact_id, current_state, requested_at, call_source)
  values (caller.id, p_contact_id, 'requested', now(), 'agent_reported')
  returning * into new_call;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'manual_call_started', 'call', new_call.id::text, jsonb_build_object('contact_id', p_contact_id));

  return jsonb_build_object('call_id', new_call.id, 'requested_at', new_call.requested_at);
end;
$$;

create or replace function public.finish_agent_manual_call(
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
  duration_seconds integer;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = auth.uid() and p.is_active = true and p.app_role = 'agent';
  if caller.id is null then raise exception 'active_agent_required'; end if;

  if p_outcome not in ('qualified', 'follow-up', 'not-interested', 'no-answer', 'busy', 'failed') then
    raise exception 'invalid_call_outcome';
  end if;
  if p_note is not null and length(p_note) > 5000 then raise exception 'call_note_too_long'; end if;
  if p_outcome = 'follow-up' and p_callback_at is null then raise exception 'callback_time_required'; end if;
  if p_callback_at is not null and (p_callback_at <= now() or p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone)) then
    raise exception 'invalid_callback_schedule';
  end if;

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
      manual_duration_seconds = duration_seconds,
      outcome = p_outcome
  where c.id = target_call.id
  returning * into target_call;

  insert into public.call_dispositions (call_id, agent_id, outcome, note, qualified, callback_at, callback_timezone)
  values (target_call.id, caller.id, p_outcome, nullif(trim(coalesce(p_note, '')), ''), p_outcome = 'qualified', p_callback_at, p_timezone)
  returning id into disposition_id;

  if p_callback_at is not null then
    insert into public.callbacks (contact_id, agent_id, due_at, timezone, status, source_call_id)
    values (target_call.ghl_contact_id, caller.id, p_callback_at, p_timezone, 'scheduled', target_call.id)
    returning id into new_callback_id;
  end if;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (caller.id, 'manual_call_completed', 'call', target_call.id::text,
    jsonb_build_object('outcome', p_outcome, 'disposition_id', disposition_id, 'callback_id', new_callback_id));

  return jsonb_build_object(
    'call_id', target_call.id,
    'state', target_call.current_state,
    'ended_at', target_call.ended_at,
    'manual_duration_seconds', duration_seconds,
    'outcome', p_outcome,
    'disposition_id', disposition_id,
    'callback_id', new_callback_id
  );
end;
$$;

revoke all on function public.start_agent_manual_call(text) from public;
revoke all on function public.finish_agent_manual_call(uuid, text, text, timestamptz, text) from public;
grant execute on function public.start_agent_manual_call(text) to authenticated;
grant execute on function public.finish_agent_manual_call(uuid, text, text, timestamptz, text) to authenticated;

comment on column public.calls.call_source is 'provider means provider-originated; agent_reported means an agent manually confirmed the call in the UI.';
comment on column public.calls.manual_duration_seconds is 'Duration between server-recorded manual start and agent-confirmed end; not provider-verified.';
comment on function public.start_agent_manual_call(text) is 'Starts an agent-reported call log after application server has revalidated the assigned Open contact in GHL.';
comment on function public.finish_agent_manual_call(uuid, text, text, timestamptz, text) is 'Completes an agent-reported call, saving disposition/comment and optional callback; duration is explicitly unverified.';
