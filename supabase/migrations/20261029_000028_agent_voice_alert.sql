alter table public.company_memberships
  add column if not exists voice_alert_enabled boolean not null default false,
  add column if not exists voice_alert_text text;

alter table public.company_memberships
  add constraint company_memberships_voice_alert_text_length
  check (voice_alert_text is null or length(voice_alert_text) <= 1000);
