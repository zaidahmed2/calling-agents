import { describe, expect, it } from "vitest";

import { getContactCallStatus } from "@/lib/contact-call-status";

describe("contact call result classification", () => {
  it("marks a call answered by the provider or disposition as picked", () => {
    expect(getContactCallStatus({ answered_at: "2026-10-21T00:00:00Z", current_state: "completed", outcome: "not-picked" }, true)).toBe("picked");
    expect(getContactCallStatus({ answered_at: null, current_state: "completed", outcome: "interested" }, true)).toBe("picked");
  });

  it("marks a completed unanswered call as not picked", () => {
    expect(getContactCallStatus({ answered_at: null, current_state: "completed", outcome: "busy" }, true)).toBe("not-picked");
  });

  it("distinguishes never called contacts from incomplete call history", () => {
    expect(getContactCallStatus(undefined, true)).toBe("not-called");
    expect(getContactCallStatus(undefined, false)).toBe("unknown");
  });

  it("shows active attempts as in progress", () => {
    expect(getContactCallStatus({ answered_at: null, current_state: "ringing", outcome: null }, true)).toBe("in-progress");
  });
});
