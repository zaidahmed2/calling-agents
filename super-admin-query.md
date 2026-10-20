# Promote a Supabase Auth user to Super Admin

Run this in the **SQL Editor for the central application Supabase project** (not a
company tenant project). The multitenant migration
`supabase/migrations/20261016_000015_multitenant_foundation.sql` must already
have been applied because it adds `profiles.platform_role`.

This query matches both the Auth user ID and email before making any change. It
creates the application profile if it does not exist, or promotes the existing
profile. It does not change the Auth user's password or email verification.

```sql
begin;

do $$
declare
  target_user auth.users%rowtype;
begin
  select *
  into target_user
  from auth.users
  where id = 'c848dee1-1865-46f5-9997-fa640512ef1e'::uuid
    and lower(email) = lower('chishti@teknoverse.com.au');

  if not found then
    raise exception 'No Auth user matches the supplied ID and email; no profile was changed.';
  end if;

  insert into public.profiles (
    id,
    normalized_email,
    ghl_user_id,
    app_role,
    platform_role,
    is_active
  )
  values (
    target_user.id,
    lower(target_user.email),
    null,
    'admin'::public.app_role,
    'super_admin',
    true
  )
  on conflict (id) do update
  set normalized_email = excluded.normalized_email,
      platform_role = 'super_admin',
      is_active = true;
end
$$;

commit;

select id, normalized_email, platform_role, is_active
from public.profiles
where id = 'c848dee1-1865-46f5-9997-fa640512ef1e'::uuid;
```

The final query should return the account with `platform_role` set to
`super_admin` and `is_active` set to `true`. The application checks this profile
field when signing in and routes Super Admin users to `/super-admin`.
