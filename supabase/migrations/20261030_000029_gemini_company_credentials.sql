alter table public.company_integration_secrets
  drop constraint if exists company_integration_secrets_provider_check;

alter table public.company_integration_secrets
  add constraint company_integration_secrets_provider_check
  check (provider in ('ghl', 'crazytel', 'gemini'));
