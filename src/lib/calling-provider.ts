import { getCompanyCrazytelWebRtcConfig, type CrazytelWebRtcConfig } from "@/lib/crazytel";

export type CompanyCallingResult =
  | { ok: true; provider: "crazytel"; config: CrazytelWebRtcConfig }
  | { ok: false; provider: null; reason: string };

export async function getCompanyCallingConfig(companyId: string, destinationPhone: string): Promise<CompanyCallingResult> {
  const result = await getCompanyCrazytelWebRtcConfig(companyId, destinationPhone);
  return result.ok
    ? { ok: true, provider: "crazytel", config: result.config }
    : { ok: false, provider: null, reason: result.reason };
}
