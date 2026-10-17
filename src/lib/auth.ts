export type AppRole = "admin" | "agent" | "super_admin";

export type AppSession = {
  id: string;
  email: string;
  role: AppRole;
  companyId: string | null;
  isSuperAdmin: boolean;
  ghlUserId: string | null;
  displayName: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}