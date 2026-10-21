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
    and exists (select 1 from public.contacts ct where ct.id = c.internal_contact_id
      and ct.company_id = company_id_value and ct.assigned_agent_id = p_agent_id and lower(ct.status) = 'open')
  for update;
  if target_call.id is null then raise exception 'manual_call_not_actionable'; end if;

  duration_seconds := case when target_call.answered_at is null then 0
    else greatest(0, floor(extract(epoch from (now() - target_call.answered_at)))::integer) end;
  update public.calls c set current_state = 'completed', ended_at = now(), manual_duration_seconds = duration_seconds
  where c.id = target_call.id returning * into target_call;
  insert into public.activity_logs (company_id, actor_id, event_type, target_type, target_id, metadata)
  values (company_id_value, p_agent_id, 'manual_call_ended', 'call', target_call.id::text,
    jsonb_build_object('manual_duration_seconds', duration_seconds));
  return jsonb_build_object('call_id', target_call.id, 'state', target_call.current_state,
    'ended_at', target_call.ended_at, 'manual_duration_seconds', duration_seconds);
end;
$$;
