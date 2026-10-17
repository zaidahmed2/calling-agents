-- Run in the Supabase SQL Editor as an authorized project administrator.
-- Replace every REPLACE_* value before running a statement.
-- Get the auth user UUID from Supabase Authentication > Users.
-- GHL user IDs are not secrets, but must be verified against the correct account.
-- After migration 20261016_000015, add the company_memberships row for each profile.

-- Create an administrator profile.
-- GHL mapping is optional for administrators; leave it NULL if the admin does
-- not need contacts assigned to them as a calling agent.
insert into public.profiles (
  id,
  normalized_email,
  ghl_user_id,
  app_role,
  is_active
)
values (
  'REPLACE_WITH_SUPABASE_AUTH_USER_UUID'::uuid,
  lower('REPLACE_WITH_ADMIN_EMAIL'),
  null,
  'admin',
  true
);

insert into public.company_memberships (profile_id, company_id, role, is_active)
select p.id, c.id, 'admin', p.is_active
from public.profiles p cross join public.companies c
where p.normalized_email = lower('REPLACE_WITH_ADMIN_EMAIL') and c.slug = 'legacy-workspace'
on conflict (profile_id) do update set company_id = excluded.company_id, role = excluded.role, is_active = excluded.is_active;

-- Create an agent profile.
-- Use the verified GHL user ID that owns this agent's assigned contacts.
insert into public.profiles (
  id,
  normalized_email,
  ghl_user_id,
  app_role,
  is_active
)
values (
  'REPLACE_WITH_SUPABASE_AUTH_USER_UUID'::uuid,
  lower('REPLACE_WITH_AGENT_EMAIL'),
  'REPLACE_WITH_VERIFIED_GHL_USER_ID',
  'agent',
  true
);

insert into public.company_memberships (profile_id, company_id, role, is_active)
select p.id, c.id, 'agent', p.is_active
from public.profiles p cross join public.companies c
where p.normalized_email = lower('REPLACE_WITH_AGENT_EMAIL') and c.slug = 'legacy-workspace'
on conflict (profile_id) do update set company_id = excluded.company_id, role = excluded.role, is_active = excluded.is_active;

-- Verify the provisioned profiles after running the desired statement(s).
select normalized_email, ghl_user_id, app_role, is_active
from public.profiles
where lower(normalized_email) in (
  lower('REPLACE_WITH_ADMIN_EMAIL'),
  lower('REPLACE_WITH_AGENT_EMAIL')
)
order by app_role, normalized_email;