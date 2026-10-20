import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { insertMock } = vi.hoisted(() => ({ insertMock: vi.fn() }));

vi.mock("@/lib/supabase-service", () => ({
  createSupabaseServiceClient: () => ({
    from: () => ({ insert: insertMock }),
  }),
}));

vi.mock("@/lib/supabase-server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

import { auditAgentPhoneReveal } from "./work-session-activity";

describe("auditAgentPhoneReveal", () => {
  beforeEach(() => {
    insertMock.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("records phone access in the central company activity log", async () => {
    insertMock.mockResolvedValue({ error: null });

    await expect(auditAgentPhoneReveal("contact-id", "company-id", "agent-id")).resolves.toBe(true);
    expect(insertMock).toHaveBeenCalledWith({
      company_id: "company-id",
      actor_id: "agent-id",
      event_type: "agent_phone_revealed",
      target_type: "contact",
      target_id: "contact-id",
    });
  });

  it("blocks access when the audit insert fails", async () => {
    insertMock.mockResolvedValue({ error: new Error("database unavailable") });

    await expect(auditAgentPhoneReveal("contact-id", "company-id", "agent-id")).resolves.toBe(false);
  });
});
