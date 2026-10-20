import { describe, expect, it } from "vitest";

import { isCompanyId } from "@/lib/auth";

describe("company context validation", () => {
  it("accepts UUID company IDs", () => {
    expect(isCompanyId("c848dee1-1865-46f5-9997-fa640512ef1e")).toBe(true);
  });

  it("rejects missing or malformed company IDs", () => {
    expect(isCompanyId(undefined)).toBe(false);
    expect(isCompanyId("company-id")).toBe(false);
  });
});
