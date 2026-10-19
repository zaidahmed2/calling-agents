alter table public.company_memberships
  add column agent_contact_fields text[] not null default array[
    'name', 'email', 'phone', 'status', 'subject', 'notes', 'lead_source'
  ]::text[];

comment on column public.company_memberships.agent_contact_fields
  is 'CRM contact fields visible to this company agent; custom field keys use the custom: prefix.';
