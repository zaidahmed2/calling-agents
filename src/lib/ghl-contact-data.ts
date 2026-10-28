export type GhlContact = {
  id: string;
  name: string;
  email?: string;
  suburb: string | null;
  subject?: string;
  status: string | null;
  assignedUserId: string | null;
  assignedAgentIds?: string[];
  isOpen: boolean;
  phone: string | null;
  maskedPhone: string;
  lastActivityAt: string | null;
  notes?: string | null;
  leadSource?: string | null;
  customFields?: Record<string, unknown>;
};

export type AgentContact = {
  id: string;
  name: string;
  email?: string | null;
  phoneVisible: boolean;
  maskedPhone: string | null;
  status: string | null;
  details: Array<{ id: string; label: string; value: string }>;
  lastComment: string | null;
  callStatus: "picked" | "not-picked" | "not-called" | "in-progress" | "unknown";
};

const AGENT_FIELD_LABELS: Record<string, string> = {
  email: "Email",
  subject: "Subject",
  notes: "Notes",
  lead_source: "Lead source",
};

function fieldText(value: unknown): string | null {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    const text = String(value).trim();
    return text || null;
  }
  return null;
}

export function toAgentContact(contact: GhlContact, visibleFields: string[] = ["name", "phone", "status"]): AgentContact {
  const allowed = new Set(visibleFields);
  const details: AgentContact["details"] = [];
  for (const field of ["email", "subject", "notes", "lead_source"] as const) {
    const value = fieldText(field === "lead_source" ? contact.leadSource : contact[field]);
    if (allowed.has(field) && value) details.push({ id: field, label: AGENT_FIELD_LABELS[field], value });
  }
  for (const [key, value] of Object.entries(contact.customFields ?? {})) {
    const text = fieldText(value);
    if (allowed.has(`custom:${key}`) && text) details.push({ id: `custom:${key}`, label: key, value: text });
  }
  return {
    id: contact.id,
    name: allowed.has("name") ? contact.name : "Contact",
    ...(allowed.has("email") ? { email: contact.email ?? null } : {}),
    phoneVisible: allowed.has("phone"),
    maskedPhone: allowed.has("phone") ? contact.maskedPhone : null,
    status: allowed.has("status") ? contact.status : null,
    details,
    lastComment: null,
    callStatus: "unknown",
  };
}

type CustomField = {
  id?: unknown;
  key?: unknown;
  fieldKey?: unknown;
  value?: unknown;
  fieldValue?: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function normalizeFieldKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\{\{\s*|\s*\}\}$/g, "").toLowerCase();
}

export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  const countryCode = value.trim().startsWith("+")
    ? digits.startsWith("61") ? "+61" : digits.startsWith("1") ? "+1" : `+${digits.slice(0, 2)}`
    : "";
  const hiddenDigits = digits.length - countryCode.replace(/\D/g, "").length;
  return `${countryCode}${"*".repeat(Math.max(hiddenDigits, 0))}`;
}

export function normalizeGhlContact(item: Record<string, unknown>, statusFieldId: string, openStatusValue = "Open", statusFieldKey = ""): GhlContact {
  const idValue = item.id ?? item.contactId;
  const id = typeof idValue === "string" ? idValue : "";
  const firstName = typeof item.firstName === "string" ? item.firstName : "";
  const lastName = typeof item.lastName === "string" ? item.lastName : "";
  const fullName = typeof item.name === "string" ? item.name : "";
  const customFields = Array.isArray(item.customFields) ? item.customFields as CustomField[] : [];
  const expectedKey = normalizeFieldKey(statusFieldKey);
  const statusField = customFields.find((field) => field.id === statusFieldId)
    ?? customFields.find((field) => [field.key, field.fieldKey].some((key) => normalizeFieldKey(key) === expectedKey && expectedKey !== ""));
  const rawStatus = statusField?.value ?? statusField?.fieldValue;
  const status = typeof rawStatus === "string" && rawStatus.trim() ? rawStatus.trim() : null;
  const assignment = typeof item.assignedTo === "string" && item.assignedTo.trim() ? item.assignedTo : null;
  const rawPhone = typeof item.phone === "string" ? item.phone : "";
  const suburbField = customFields.find((field) => {
    const record = field as CustomField & { name?: unknown };
    const fieldLabel = typeof record.name === "string" ? record.name : "";
    return [record.key, record.fieldKey, fieldLabel].some((key) => typeof key === "string" && /(^|[._\s-])suburb($|[._\s-])/i.test(key));
  });
  const suburbValue = typeof item.city === "string" && item.city.trim()
    ? item.city
    : suburbField?.value ?? suburbField?.fieldValue;
  const name = [firstName, lastName].filter(Boolean).join(" ") || fullName || "Unknown contact";

  return {
    id,
    name,
    email: typeof item.email === "string" ? item.email : undefined,
    suburb: typeof suburbValue === "string" && suburbValue.trim() ? suburbValue.trim() : null,
    subject: typeof item.subject === "string" ? item.subject : undefined,
    status,
    assignedUserId: assignment,
    isOpen: status?.toLocaleLowerCase() === openStatusValue.toLocaleLowerCase(),
    phone: rawPhone || null,
    maskedPhone: rawPhone ? maskPhone(rawPhone) : "•••• ••••",
    lastActivityAt: typeof item.dateUpdated === "string" ? item.dateUpdated : typeof item.updatedAt === "string" ? item.updatedAt : null,
  };
}

export function extractGhlContacts(payload: unknown): Record<string, unknown>[] {
  const root = asRecord(payload);
  const data = asRecord(root.data);
  const contacts = root.contacts ?? data.contacts;
  return Array.isArray(contacts) ? contacts.map(asRecord) : [];
}

export function extractGhlPagination(payload: unknown) {
  const root = asRecord(payload);
  const meta = asRecord(root.meta);
  const data = asRecord(root.data);
  const dataMeta = asRecord(data.meta);
  const startAfter = root.startAfter ?? meta.startAfter ?? data.startAfter ?? dataMeta.startAfter;
  const startAfterId = root.startAfterId ?? meta.startAfterId ?? data.startAfterId ?? dataMeta.startAfterId;

  return {
    startAfter: typeof startAfter === "number" || typeof startAfter === "string" ? String(startAfter) : null,
    startAfterId: typeof startAfterId === "string" ? startAfterId : null,
  };
}

export function extractGhlTotal(payload: unknown): number | null {
  const root = asRecord(payload);
  const meta = asRecord(root.meta);
  const data = asRecord(root.data);
  const dataMeta = asRecord(data.meta);
  const value = root.total ?? root.totalCount ?? meta.total ?? meta.totalCount ?? data.total ?? data.totalCount ?? dataMeta.total ?? dataMeta.totalCount;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeMetadataKey(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/^\{\{\s*|\s*\}\}$/g, "").toLowerCase();
}

export function resolveGhlStatusField(payload: unknown, configuredKey: string): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object") return null;
  const root = Array.isArray(payload) ? {} : payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {};
  const candidateArrays = [
    Array.isArray(payload) ? payload : null,
    root.customFields,
    root.fields,
    data.customFields,
    data.fields,
    Array.isArray(root.data) ? root.data : null,
  ].filter(Array.isArray) as unknown[][];
  const fields = candidateArrays.flatMap((items) => items.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object"));
  const normalizedKey = normalizeMetadataKey(configuredKey);
  const exactMatches = fields.filter((field) => [field.key, field.fieldKey, field.field_key].some((value) => normalizeMetadataKey(value) === normalizedKey && normalizedKey !== ""));
  if (exactMatches.length === 1) return exactMatches[0];
  if (exactMatches.length > 1) return null;

  const finalKeyPart = normalizedKey.split(".").at(-1) ?? "";
  const nameMatches = fields.filter((field) => [field.name, field.fieldName, field.field_name].some((value) => typeof value === "string" && value.trim().toLowerCase() === finalKeyPart));
  return nameMatches.length === 1 ? nameMatches[0] : null;
}
