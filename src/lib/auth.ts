export type AppRole = "admin" | "agent" | "super_admin";

export type AppSession = {
  id: string;
  email: string;
  role: AppRole;
  companyId: string | null;
  isSuperAdmin: boolean;
  isImpersonating: boolean;
  ghlUserId: string | null;
  displayName: string;
};

export const ADMIN_COMPANY_CONTEXT_COOKIE = "tv-admin-company-context";

export function isCompanyId(value: string | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}