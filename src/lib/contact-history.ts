import { createCompanyCrmClient } from "@/lib/company-database";
import { getContactCallStatus, type ContactCallStatus } from "@/lib/contact-call-status";

export type { ContactCallStatus } from "@/lib/contact-call-status";
export type LatestContactCall = { lastCallAt: string | null; latestCallStatus: ContactCallStatus };

export async function getLatestCallsByContact(companyId: string, contactIds: string[]): Promise<Record<string, LatestContactCall>> {
  const uniqueIds = [...new Set(contactIds.filter(Boolean))];
  const empty = (latestCallStatus: ContactCallStatus): LatestContactCall => ({ lastCallAt: null, latestCallStatus });
  if (!companyId || uniqueIds.length === 0) return {};

  try {
    const { client: supabase } = await createCompanyCrmClient(companyId);
    const { data, error, count } = await supabase.from("calls")
      .select("internal_contact_id, requested_at, answered_at, current_state, outcome", { count: "exact" })
      .eq("company_id", companyId)
      .in("internal_contact_id", uniqueIds)
      .order("requested_at", { ascending: false })
      .limit(1000);
    if (error) return Object.fromEntries(uniqueIds.map((contactId) => [contactId, empty("unknown")]));

    const latestByContact = new Map<string, (typeof data)[number]>();
    for (const call of data ?? []) {
      if (call.internal_contact_id && !latestByContact.has(call.internal_contact_id)) {
        latestByContact.set(call.internal_contact_id, call);
      }
    }
    const fullyRead = (data?.length ?? 0) >= (count ?? 0);
    return Object.fromEntries(uniqueIds.map((contactId) => {
      const call = latestByContact.get(contactId);
      const latestCallStatus = getContactCallStatus(call
        ? { answered_at: call.answered_at, current_state: String(call.current_state), outcome: call.outcome }
        : undefined, fullyRead);
      if (!call) return [contactId, empty(latestCallStatus)];
      return [contactId, { lastCallAt: call.requested_at, latestCallStatus }];
    }));
  } catch {
    return Object.fromEntries(uniqueIds.map((contactId) => [contactId, empty("unknown")]));
  }
}

export async function getLatestCallDatesByContact(companyId: string, contactIds: string[]): Promise<Record<string, string | null>> {
  const calls = await getLatestCallsByContact(companyId, contactIds);
  return Object.fromEntries(Object.entries(calls).map(([id, call]) => [id, call.lastCallAt]));
}