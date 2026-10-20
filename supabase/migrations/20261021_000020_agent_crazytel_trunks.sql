alter table public.company_memberships
  add column crazytel_trunk_id uuid,
  add column crazytel_trunk_username text;

create unique index company_memberships_crazytel_trunk
  on public.company_memberships (company_id, crazytel_trunk_id)
  where crazytel_trunk_id is not null;

comment on column public.company_memberships.crazytel_trunk_id
  is 'Crazytel SIP trunk assigned to this company agent.';
comment on column public.company_memberships.crazytel_trunk_username
  is 'Crazytel SIP trunk username assigned to this company agent.';
