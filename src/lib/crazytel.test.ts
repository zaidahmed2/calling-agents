import { describe, expect, it } from "vitest";

import { buildCrazytelCallerIdHeaders, buildCrazytelOutboundTarget, normalizeCrazytelSipUsername } from "./crazytel-utils";

describe("Crazytel outbound SIP target", () => {
  it("uses Crazytel's confirmed PSTN URI and normalizes Australian national numbers", () => {
    expect(buildCrazytelOutboundTarget("sip:{number}@hybrid.sip.crazytel.net.au", "0422 436 270"))
      .toBe("sip:61422436270@hybrid.sip.crazytel.net.au");
  });

  it("substitutes a normalized international number into a confirmed SIP template", () => {
    expect(buildCrazytelOutboundTarget("sip:{number}@confirmed.example", "+61 (400) 111 222"))
      .toBe("sip:61400111222@confirmed.example");
  });

  describe("Crazytel SIP username", () => {
    it("accepts a username or full WebRTC SIP address", () => {
      expect(normalizeCrazytelSipUsername("Hybrid087051")).toBe("Hybrid087051");
      expect(normalizeCrazytelSipUsername("sip:Hybrid087051@hybrid.sip.crazytel.net.au")).toBe("Hybrid087051");
    });

    it("rejects addresses from an unexpected SIP host", () => {
      expect(normalizeCrazytelSipUsername("sip:user@example.com")).toBeNull();
    });
  });

  describe("Crazytel caller ID headers", () => {
    it("adds both caller ID headers for a valid assigned number", () => {
      expect(buildCrazytelCallerIdHeaders("+61 485 962 007")).toEqual([
        "Remote-Party-ID: 61485962007",
        "P-Asserted-Identity: 61485962007",
      ]);
    });

    it("does not add headers when no valid caller ID is assigned", () => {
      expect(buildCrazytelCallerIdHeaders(null)).toEqual([]);
      expect(buildCrazytelCallerIdHeaders("1234")).toEqual([]);
    });
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
