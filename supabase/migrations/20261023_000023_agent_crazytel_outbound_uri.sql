alter table public.company_memberships
  add column crazytel_outbound_uri_template text;

comment on column public.company_memberships.crazytel_outbound_uri_template
  is 'Crazytel PSTN SIP Request-URI template confirmed by the provider for this agent trunk.';

comment on column public.company_memberships.crazytel_caller_id
  is 'Verified caller ID configured on this agent''s assigned Crazytel trunk.';
