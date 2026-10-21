export type ContactCallStatus = "picked" | "not-picked" | "not-called" | "in-progress" | "unknown";

export function getContactCallStatus(
  call: { answered_at: string | null; current_state: string; outcome: string | null } | undefined,
  completeHistory: boolean,
): ContactCallStatus {
  if (!call) return completeHistory ? "not-called" : "unknown";
  if (call.answered_at || ["picked", "interested", "call-later"].includes(call.outcome ?? "")) return "picked";
  if (["completed", "failed", "cancelled"].includes(call.current_state)) return "not-picked";
  return "in-progress";
}
