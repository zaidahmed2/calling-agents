alter table public.company_memberships
  add column crazytel_caller_id text;

create unique index company_memberships_crazytel_caller_id
  on public.company_memberships (company_id, crazytel_caller_id)
  where crazytel_caller_id is not null;

comment on column public.company_memberships.crazytel_caller_id
  is 'Verified Crazytel caller ID staged for this company agent; does not alter SIP calling until caller-ID passthrough is enabled.';
