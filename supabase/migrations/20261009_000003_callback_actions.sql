create or replace function public.complete_callback(p_callback_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role public.app_role;
  callback_agent_id uuid;
begin
  select p.app_role into caller_role
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;

  if caller_role is null then
    return false;
  end if;

  select c.agent_id into callback_agent_id
  from public.callbacks c
  where c.id = p_callback_id;

  if callback_agent_id is null or (caller_role <> 'admin' and callback_agent_id <> auth.uid()) then
    return false;
  end if;

  update public.callbacks
  set status = 'completed', completed_at = now()
  where id = p_callback_id and status in ('scheduled', 'due', 'missed');

  if not found then
    return false;
  end if;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (auth.uid(), 'callback_completed', 'callback', p_callback_id::text, '{}'::jsonb);

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
  caller_role public.app_role;
  callback_agent_id uuid;
begin
  select p.app_role into caller_role
  from public.profiles p
  where p.id = auth.uid() and p.is_active = true;

  if caller_role is null or p_due_at <= now() or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    return false;
  end if;

  select c.agent_id into callback_agent_id
  from public.callbacks c
  where c.id = p_callback_id;

  if callback_agent_id is null or (caller_role <> 'admin' and callback_agent_id <> auth.uid()) then
    return false;
  end if;

  update public.callbacks
  set due_at = p_due_at, timezone = p_timezone, status = 'scheduled', completed_at = null
  where id = p_callback_id and status in ('scheduled', 'due', 'missed');

  if not found then
    return false;
  end if;

  insert into public.activity_logs (actor_id, event_type, target_type, target_id, metadata)
  values (auth.uid(), 'callback_rescheduled', 'callback', p_callback_id::text, jsonb_build_object('due_at', p_due_at, 'timezone', p_timezone));

  return true;
end;
$$;

revoke all on function public.complete_callback(uuid) from public;
revoke all on function public.reschedule_callback(uuid, timestamptz, text) from public;
grant execute on function public.complete_callback(uuid) to authenticated;
grant execute on function public.reschedule_callback(uuid, timestamptz, text) to authenticated;