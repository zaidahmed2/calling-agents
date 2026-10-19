create type public.company_database_mode as enum ('shared', 'external');

create table public.company_databases (
  company_id uuid primary key references public.companies(id) on delete cascade,
  database_mode public.company_database_mode not null default 'shared',
  project_ref text,
  connection_status text not null default 'pending'
    check (connection_status in ('pending', 'ready', 'failed', 'disabled')),
  tenant_schema_version text,
  migration_status text not null default 'pending'
    check (migration_status in ('pending', 'current', 'failed', 'unknown')),
  last_connected_at timestamptz,
  last_migration_at timestamptz,
  provisioning_error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (database_mode = 'shared' and project_ref is null)
    or (database_mode = 'external')
  )
);

create table public.company_database_secrets (
  company_id uuid primary key references public.company_databases(company_id) on delete cascade,
  credentials_ciphertext text not null,
  updated_at timestamptz not null default now()
);

insert into public.company_databases (
  company_id, database_mode, connection_status, tenant_schema_version,
  migration_status, last_connected_at, last_migration_at
)
select id, 'shared', 'ready', 'shared', 'current', now(), now()
from public.companies
on conflict (company_id) do nothing;

create index company_databases_status on public.company_databases (connection_status);

create trigger trg_company_databases_updated_at
before update on public.company_databases
for each row execute function public.set_updated_at();

alter table public.company_databases enable row level security;
alter table public.company_database_secrets enable row level security;

revoke all on table public.company_databases from anon;
grant select, insert, update, delete on table public.company_databases to authenticated;
grant all on table public.company_databases to service_role;

create policy company_databases_read_company
on public.company_databases for select to authenticated
using (public.is_super_admin() or public.is_company_member(company_id));

create policy company_databases_manage_platform
on public.company_databases for all to authenticated
using (public.is_super_admin()) with check (public.is_super_admin());

revoke all on table public.company_database_secrets from anon, authenticated;
grant all on table public.company_database_secrets to service_role;
