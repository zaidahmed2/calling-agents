-- These checks are meant for a Supabase local dev database or a staging database with auth configured.
-- They validate the access model described in the Stage 4 implementation plan.

-- 1. Admin user can read profile rows for all users.
-- Example:
-- select * from public.profiles where app_role in ('admin', 'agent');

-- 2. Agent user can read only their own profile and only assigned contacts.
-- Example:
-- select * from public.profiles where id = auth.uid();
-- select * from public.contacts_cache where assigned_ghl_user_id = (select ghl_user_id from public.profiles where id = auth.uid());

-- 3. Agent cannot change their role through a normal update.
-- Example expected result: statement fails under RLS.
-- update public.profiles set app_role = 'admin' where id = auth.uid();

-- 4. Agent cannot read another agent's call records.
-- Example expected result: statement returns no rows if the current user is not the owner.
-- select * from public.calls where agent_id <> auth.uid();

-- 5. Admin can view audit and webhook records.
-- Example:
-- select * from public.webhook_events limit 10;
-- select * from public.audit_logs limit 10;

-- 6. Anonymous or unauthenticated users should not access protected tables.
-- Example expected result: zero rows or access denied.
-- select * from public.profiles;

-- For full automated validation in Supabase, run these checks inside a proper auth context using a test user JWT.
