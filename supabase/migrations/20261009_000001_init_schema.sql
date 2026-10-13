create extension if not exists pgcrypto;
create extension if not exists citext;

create type public.app_role as enum ('admin', 'agent');
create type public.work_session_state as enum ('active', 'paused', 'ended', 'idle');
create type public.call_state as enum ('requested', 'ringing', 'answered', 'completed', 'failed', 'cancelled');
create type public.callback_status as enum ('scheduled', 'due', 'completed', 'missed', 'cancelled');
create type public.webhook_processing_state as enum ('received', 'processing', 'processed', 'failed');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  normalized_email citext not null unique,
  ghl_user_id text not null unique,
  app_role app_role not null default 'agent',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_ghl_user_id on public.profiles (ghl_user_id);
create index if not exists idx_profiles_app_role on public.profiles (app_role);
create index if not exists idx_profiles_active on public.profiles (is_active);

create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create table if not exists public.contacts_cache (
  id uuid primary key default gen_random_uuid(),
  ghl_contact_id text not null unique,
  assigned_ghl_user_id text,
  current_status text not null default 'open',
  safe_display_name text,
  safe_subject text,
  masked_phone text,
  sync_status text not null default 'pending',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contacts_cache_assigned_user on public.contacts_cache (assigned_ghl_user_id);
create index if not exists idx_contacts_cache_status on public.contacts_cache (current_status);
create index if not exists idx_contacts_cache_sync_status on public.contacts_cache (sync_status);

create trigger trg_contacts_cache_updated_at
before update on public.contacts_cache
for each row execute function public.set_updated_at();

create table if not exists public.work_sessions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  last_activity_at timestamptz,
  state work_session_state not null default 'active',
  idle_seconds integer not null default 0,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_work_sessions_agent_id on public.work_sessions (agent_id);
create index if not exists idx_work_sessions_state on public.work_sessions (state);
create index if not exists idx_work_sessions_started_at on public.work_sessions (started_at);

create trigger trg_work_sessions_updated_at
before update on public.work_sessions
for each row execute function public.set_updated_at();

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_logs_actor_id on public.activity_logs (actor_id);
create index if not exists idx_activity_logs_event_type on public.activity_logs (event_type);
create index if not exists idx_activity_logs_created_at on public.activity_logs (created_at);

create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  provider_call_id text unique,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  ghl_contact_id text not null,
  current_state call_state not null default 'requested',
  requested_at timestamptz not null default now(),
  ringing_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  verified_duration_seconds integer,
  outcome text,
  recording_reference text,
  sync_state text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_calls_agent_id on public.calls (agent_id);
create index if not exists idx_calls_contact_id on public.calls (ghl_contact_id);
create index if not exists idx_calls_state on public.calls (current_state);
create index if not exists idx_calls_requested_at on public.calls (requested_at);

create trigger trg_calls_updated_at
before update on public.calls
for each row execute function public.set_updated_at();

create table if not exists public.call_dispositions (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  outcome text not null,
  note text,
  qualified boolean not null default false,
  callback_at timestamptz,
  callback_timezone text,
  created_at timestamptz not null default now()
);

create index if not exists idx_call_dispositions_call_id on public.call_dispositions (call_id);
create index if not exists idx_call_dispositions_agent_id on public.call_dispositions (agent_id);
create index if not exists idx_call_dispositions_callback_at on public.call_dispositions (callback_at);

create table if not exists public.callbacks (
  id uuid primary key default gen_random_uuid(),
  contact_id text not null,
  agent_id uuid not null references public.profiles(id) on delete cascade,
  due_at timestamptz not null,
  timezone text not null default 'UTC',
  status callback_status not null default 'scheduled',
  source_call_id uuid references public.calls(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_callbacks_agent_id on public.callbacks (agent_id);
create index if not exists idx_callbacks_due_at on public.callbacks (due_at);
create index if not exists idx_callbacks_status on public.callbacks (status);

create trigger trg_callbacks_updated_at
before update on public.callbacks
for each row execute function public.set_updated_at();

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  external_event_id text not null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_state webhook_processing_state not null default 'received',
  error_message text,
  created_at timestamptz not null default now(),
  unique (provider, external_event_id)
);

create index if not exists idx_webhook_events_provider on public.webhook_events (provider);
create index if not exists idx_webhook_events_event_type on public.webhook_events (event_type);
create index if not exists idx_webhook_events_processing_state on public.webhook_events (processing_state);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target_type text,
  target_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_audit_logs_actor_id on public.audit_logs (actor_id);
create index if not exists idx_audit_logs_action on public.audit_logs (action);
create index if not exists idx_audit_logs_created_at on public.audit_logs (created_at);

alter table public.profiles enable row level security;
alter table public.contacts_cache enable row level security;
alter table public.work_sessions enable row level security;
alter table public.activity_logs enable row level security;
alter table public.calls enable row level security;
alter table public.call_dispositions enable row level security;
alter table public.callbacks enable row level security;
alter table public.webhook_events enable row level security;
alter table public.audit_logs enable row level security;

create policy "profiles_select_own_or_admin"
on public.profiles
for select
using (
  id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "profiles_update_self_not_role"
on public.profiles
for update
using (id = auth.uid())
with check (
  id = auth.uid()
  and app_role = (select app_role from public.profiles where id = auth.uid())
  and is_active = (select is_active from public.profiles where id = auth.uid())
);

create policy "profiles_admin_full_access"
on public.profiles
for all
using (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "contacts_cache_admin_full_access"
on public.contacts_cache
for all
using (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "contacts_cache_agent_assigned_only"
on public.contacts_cache
for select
using (
  assigned_ghl_user_id = (
    select ghl_user_id from public.profiles where id = auth.uid()
  )
);

create policy "work_sessions_agent_own_or_admin"
on public.work_sessions
for all
using (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "activity_logs_agent_own_or_admin"
on public.activity_logs
for select
using (
  actor_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "calls_agent_own_or_admin"
on public.calls
for all
using (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "call_dispositions_agent_own_or_admin"
on public.call_dispositions
for all
using (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "callbacks_agent_own_or_admin"
on public.callbacks
for all
using (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  agent_id = auth.uid()
  or exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "webhook_events_admin_only"
on public.webhook_events
for all
using (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

create policy "audit_logs_admin_only"
on public.audit_logs
for all
using (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles admin_profile
    where admin_profile.id = auth.uid()
      and admin_profile.app_role = 'admin'
  )
);

comment on table public.profiles is 'Application user registry with explicit role mapping and GHL identity data.';
comment on table public.contacts_cache is 'Server-side cache of sanitized GHL contact metadata used for Open-queue filtering.';
comment on table public.work_sessions is 'Agent work session state and idle tracking.';
comment on table public.calls is 'Managed call lifecycle records with provider and agent metadata.';
comment on table public.call_dispositions is 'Immutable outcome and note records for completed calls.';
comment on table public.callbacks is 'Agent callback queue and due dates.';
comment on table public.webhook_events is 'Incoming provider events used for idempotent processing. Service-role only for writes when handled server-side.';
comment on table public.audit_logs is 'Audit trail for privileged actions and sensitive access events.';

-- Service-role keys stay server-side. These tables intentionally rely on Supabase RLS and server-side access patterns.
