import { describe, expect, it } from "vitest";

import { getCrazytelApiBaseUrl } from "./crazytel-api";

describe("Crazytel API base URL validation", () => {
  it("allows the official API hosts over HTTPS", () => {
    expect(getCrazytelApiBaseUrl("https://api.crazytel.io").hostname).toBe("api.crazytel.io");
    expect(getCrazytelApiBaseUrl("https://crazytel.io").hostname).toBe("crazytel.io");
  });

  it("rejects non-provider hosts and insecure URLs", () => {
    expect(() => getCrazytelApiBaseUrl("https://example.com")).toThrow();
    expect(() => getCrazytelApiBaseUrl("http://api.crazytel.io")).toThrow();
    expect(() => getCrazytelApiBaseUrl("https://api.crazytel.io.attacker.example")).toThrow();
  });
});
