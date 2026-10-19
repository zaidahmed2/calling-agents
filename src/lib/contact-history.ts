import { createCompanyCrmClient } from "@/lib/company-database";

export async function getLatestCallDatesByContact(companyId: string, contactIds: string[]): Promise<Record<string, string | null>> {
  const uniqueIds = [...new Set(contactIds.filter(Boolean))];
  if (!companyId || uniqueIds.length === 0) return {};

  try {
    const { client: supabase } = await createCompanyCrmClient(companyId);
    const entries = await Promise.all(uniqueIds.map(async (contactId) => {
      const { data, error } = await supabase
        .from("calls")
        .select("requested_at")
        .eq("company_id", companyId)
        .eq("internal_contact_id", contactId)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return [contactId, error ? null : data?.requested_at ?? null] as const;
    }));

    return Object.fromEntries(entries);
  } catch {
    return Object.fromEntries(uniqueIds.map((contactId) => [contactId, null]));
  }
}