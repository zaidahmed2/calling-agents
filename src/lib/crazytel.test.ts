import { describe, expect, it } from "vitest";

import { buildCrazytelOutboundTarget } from "./crazytel-utils";

describe("Crazytel outbound SIP target", () => {
  it("substitutes a normalized international number into a confirmed SIP template", () => {
    expect(buildCrazytelOutboundTarget("sip:{number}@confirmed.example", "+61 (400) 111 222"))
      .toBe("sip:61400111222@confirmed.example");
  });

  it("refuses to guess a target when the provider URI format is unset", () => {
    expect(buildCrazytelOutboundTarget("", "61400111222")).toBeNull();
    expect(buildCrazytelOutboundTarget("sip:{number}@confirmed.example", "1234")).toBeNull();
  });

  it("rejects non-SIP or whitespace-bearing templates", () => {
    expect(buildCrazytelOutboundTarget("https://example.test/{number}", "61400111222")).toBeNull();
    expect(buildCrazytelOutboundTarget("sip:{number} @example.test", "61400111222")).toBeNull();
  });
});
