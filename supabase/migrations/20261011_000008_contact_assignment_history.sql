create table if not exists public.contact_assignment_events (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null,
  from_ghl_user_id text,
  to_ghl_user_id text,
  actor_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint contact_assignment_events_change_check check (from_ghl_user_id is distinct from to_ghl_user_id)
);

create index if not exists idx_contact_assignment_events_contact on public.contact_assignment_events (ghl_contact_id, created_at desc);
create index if not exists idx_contact_assignment_events_target on public.contact_assignment_events (to_ghl_user_id, created_at desc);
create index if not exists idx_contact_assignment_events_actor on public.contact_assignment_events (actor_id, created_at desc);

alter table public.contact_assignment_events enable row level security;

drop policy if exists "contact_assignment_events_admin_read" on public.contact_assignment_events;
create policy "contact_assignment_events_admin_read"
on public.contact_assignment_events
for select to authenticated
using (public.is_app_admin());

create or replace function public.record_admin_contact_assignment(
  p_contact_id text,
  p_from_ghl_user_id text,
  p_to_ghl_user_id text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  caller public.profiles%rowtype;
  event_id uuid;
begin
  select p.* into caller
  from public.profiles as p
  where p.id = auth.uid() and p.is_active = true and p.app_role = 'admin';
  if caller.id is null then raise exception 'active_admin_required'; end if;
  if p_contact_id is null or length(p_contact_id) = 0 or length(p_contact_id) > 100 then
    raise exception 'invalid_contact_id';
  end if;
  if p_from_ghl_user_id is not distinct from p_to_ghl_user_id then
    return null;
  end if;

  insert into public.contact_assignment_events (ghl_contact_id, from_ghl_user_id, to_ghl_user_id, actor_id)
  values (p_contact_id, p_from_ghl_user_id, p_to_ghl_user_id, caller.id)
  returning id into event_id;

  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata)
  values (caller.id, 'contact_assignment_changed', 'contact', p_contact_id,
    jsonb_build_object('from_ghl_user_id', p_from_ghl_user_id, 'to_ghl_user_id', p_to_ghl_user_id));

  return event_id;
end;
$$;

revoke all on function public.record_admin_contact_assignment(text, text, text) from public;
grant execute on function public.record_admin_contact_assignment(text, text, text) to authenticated;

comment on table public.contact_assignment_events is 'Append-only history of assignments made through Terraverse; no pre-migration GHL history is backfilled.';
