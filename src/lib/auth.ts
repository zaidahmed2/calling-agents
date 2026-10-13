export type AppRole = "admin" | "agent";

export type AppSession = {
  id: string;
  email: string;
  role: AppRole;
  ghlUserId: string | null;
  displayName: string;
};

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}