import { describe, expect, it, vi } from "vitest";

import { createRateLimiter, isWithinRateLimit } from "./rate-limit";

describe("rate-limit helpers", () => {
  it("allows requests under the configured threshold", () => {
    const limiter = createRateLimiter({ limit: 3, windowMs: 60_000 });

    expect(isWithinRateLimit(limiter, "agent-a")).toBe(true);
    expect(isWithinRateLimit(limiter, "agent-a")).toBe(true);
    expect(isWithinRateLimit(limiter, "agent-a")).toBe(true);
  });

  it("blocks repeated requests after the threshold is reached", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });

    expect(isWithinRateLimit(limiter, "agent-b")).toBe(true);
    expect(isWithinRateLimit(limiter, "agent-b")).toBe(true);
    expect(isWithinRateLimit(limiter, "agent-b")).toBe(false);
  });

  it("clears stale requests after the time window expires", () => {
    const now = vi.fn();
    const limiter = createRateLimiter({ limit: 1, windowMs: 1000, now });

    now.mockReturnValueOnce(1_000);
    expect(isWithinRateLimit(limiter, "agent-c")).toBe(true);

    now.mockReturnValueOnce(2_000);
    expect(isWithinRateLimit(limiter, "agent-c")).toBe(true);

    now.mockReturnValueOnce(2_500);
    expect(isWithinRateLimit(limiter, "agent-c")).toBe(false);
  });
});
