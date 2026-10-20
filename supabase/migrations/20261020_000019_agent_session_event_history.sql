create table public.work_session_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  session_id uuid references public.work_sessions(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in (
    'login', 'session_started', 'session_paused', 'session_resumed', 'session_ended'
  )),
  reason text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index work_session_events_company_time
  on public.work_session_events (company_id, occurred_at desc);
create index work_session_events_agent_time
  on public.work_session_events (agent_id, occurred_at desc);
create index work_session_events_session_time
  on public.work_session_events (session_id, occurred_at);

alter table public.work_session_events enable row level security;
revoke all on table public.work_session_events from anon;
grant select on table public.work_session_events to authenticated;

create policy work_session_events_read_company
on public.work_session_events for select to authenticated
using (
  public.is_company_admin(company_id)
  or (public.is_company_member(company_id) and agent_id = auth.uid())
);

create or replace function public.record_work_session_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  event_type_value text;
begin
  if tg_op = 'INSERT' then
    event_type_value := 'session_started';
  elsif new.state is distinct from old.state then
    event_type_value := case new.state::text
      when 'paused' then 'session_paused'
      when 'active' then 'session_resumed'
      when 'ended' then 'session_ended'
      else null
    end;
  end if;

  if event_type_value is not null then
    insert into public.work_session_events (
      company_id, session_id, agent_id, event_type, reason, occurred_at
    ) values (
      new.company_id,
      new.id,
      new.agent_id,
      event_type_value,
      new.reason,
      coalesce(new.state_changed_at, new.started_at, now())
    );
  end if;

  return new;
end;
$$;

create trigger trg_record_work_session_event
after insert or update on public.work_sessions
for each row execute function public.record_work_session_event();

create or replace function public.record_agent_login()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  company_id_value uuid;
begin
  select m.company_id into company_id_value
  from public.company_memberships m
  join public.profiles p on p.id = m.profile_id
  join public.companies c on c.id = m.company_id
  where m.profile_id = auth.uid()
    and m.role = 'agent'
    and m.is_active
    and p.is_active
    and c.status = 'active';

  if company_id_value is null then
    return false;
  end if;

  insert into public.work_session_events (
    company_id, agent_id, event_type, occurred_at
  ) values (
    company_id_value, auth.uid(), 'login', now()
  );

  return true;
end;
$$;

revoke all on function public.record_work_session_event() from public, anon, authenticated;
revoke all on function public.record_agent_login() from public, anon;
grant execute on function public.record_agent_login() to authenticated;
