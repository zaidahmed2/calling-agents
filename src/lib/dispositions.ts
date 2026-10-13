import { env } from "@/lib/env";

export type DispositionOutcome =
  | "qualified"
  | "follow-up"
  | "not-interested"
  | "no-answer"
  | "busy"
  | "failed";

export type CallDispositionInput = {
  contactId: string;
  agentId: string;
  outcome: DispositionOutcome;
  notes?: string;
  qualified?: boolean;
  callbackAt?: string;
  providerCallId?: string;
};

export type DispositionSyncResult = {
  ok: boolean;
  blocked: boolean;
  status: "queued" | "blocked" | "processed";
  reason?: string;
  dispositionId?: string;
};

const missingOrPlaceholder = (value?: string) => !value || value.trim() === "" || /your_|change_me|placeholder|example|mock/i.test(value);

export async function syncDispositionToGhl(input: CallDispositionInput): Promise<DispositionSyncResult> {
  const missingGhlConfig =
    missingOrPlaceholder(env.ghlPrivateIntegrationKey) ||
    missingOrPlaceholder(env.ghlLocationId);

  if (missingGhlConfig) {
    return {
      ok: false,
      blocked: true,
      status: "blocked",
      reason: "GHL account verification is still required before a disposition can sync to the CRM.",
    };
  }

  const dispositionId = `disposition-${Date.now()}-${input.contactId}`;

  return {
    ok: false,
    blocked: true,
    status: "blocked",
    reason: "Disposition sync is intentionally disabled until the real GHL account contract, subject field, and note-write endpoint are verified against the live CRM configuration.",
    dispositionId,
  };
}

export function normalizeOutcome(value: string): DispositionOutcome {
  const normalized = value.toLowerCase();

  if (normalized.includes("qual")) return "qualified";
  if (normalized.includes("follow") || normalized.includes("callback")) return "follow-up";
  if (normalized.includes("not")) return "not-interested";
  if (normalized.includes("busy")) return "busy";
  if (normalized.includes("fail")) return "failed";
  return "no-answer";
}
