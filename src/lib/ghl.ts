import { env } from "@/lib/env";
import {
  extractGhlContacts,
  extractGhlPagination,
  extractGhlTotal,
  normalizeGhlContact,
  resolveGhlStatusField,
  toAgentContact,
  type AgentContact,
  type GhlContact,
} from "@/lib/ghl-contact-data";

export type { AgentContact, GhlContact } from "@/lib/ghl-contact-data";

export type GhlCursor = { startAfter: string | null; startAfterId: string | null };

export type GhlContactPage = {
  contacts: GhlContact[];
  blocked: boolean;
  blocker?: string;
  nextCursor: GhlCursor | null;
  total: number | null;
};

export type GhlContactMutation = {
  assignedTo?: string | null;
  status?: string;
  customFields?: Array<{ id: string; key: string; fieldValue: string }>;
};

export type CallStage = "picked" | "not-picked" | "call-later" | "busy" | "interested";
export type GhlCallSyncResult = { status: "synced" | "not_configured" | "failed"; reason?: string };

export type AgentContactQueueResult =
  | { blocked: true; blocker: string; contacts: AgentContact[]; nextCursor: null; hasMore: false; total: null }
  | { blocked: false; contacts: AgentContact[]; nextCursor: GhlCursor | null; hasMore: boolean; total: number | null };

const GHL_API_BASE_URL = "https://services.leadconnectorhq.com";
const PLACEHOLDER = /your_|change_me|placeholder|example|mock/i;
const validValue = (value: string) => Boolean(value.trim()) && !PLACEHOLDER.test(value);
const customFieldCache = new Map<string, { field: Record<string, unknown> | null; expiresAt: number }>();

export function getGhlConfigurationIssue(requireStatusField = false): string | null {
  if (!validValue(env.ghlPrivateIntegrationKey)) return "GHL Private Integration key is not configured.";
  if (!validValue(env.ghlLocationId)) return "GHL sub-account/location ID is not configured.";
  if (requireStatusField && !validValue(env.ghlContactStatusFieldKey)) return "GHL_CONTACT_STATUS_FIELD_KEY is not configured.";
  return null;
}

function buildHeaders(json = false) {
  const headers = new Headers({
    Accept: "application/json",
    Authorization: `Bearer ${env.ghlPrivateIntegrationKey}`,
    Version: "v3",
  });
  if (json) headers.set("Content-Type", "application/json");
  return headers;
}

function contactFromPayload(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const contact = record.contact ?? data.contact;
  return contact && typeof contact === "object" && !Array.isArray(contact) ? contact as Record<string, unknown> : record;
}

export async function getGhlContactStatusField(): Promise<Record<string, unknown> | null> {
  if (getGhlConfigurationIssue(true)) return null;
  return getGhlContactCustomField(env.ghlContactStatusFieldKey);
}

export async function getGhlContactCustomField(fieldKey: string): Promise<Record<string, unknown> | null> {
  const normalizedKey = fieldKey.trim();
  if (!normalizedKey || getGhlConfigurationIssue()) return null;
  const cached = customFieldCache.get(normalizedKey);
  if (cached && cached.expiresAt > Date.now()) return cached.field;

  try {
    const endpoint = new URL(`${GHL_API_BASE_URL}/locations/${encodeURIComponent(env.ghlLocationId)}/customFields`);
    endpoint.searchParams.set("model", "contact");
    const response = await fetch(endpoint, { headers: buildHeaders(), cache: "no-store" });
    if (!response.ok) {
      customFieldCache.set(normalizedKey, { field: null, expiresAt: Date.now() + 30_000 });
      return null;
    }

    const field = resolveGhlStatusField(await response.json(), normalizedKey);
    customFieldCache.set(normalizedKey, { field, expiresAt: Date.now() + 60_000 });
    return field;
  } catch {
    customFieldCache.set(normalizedKey, { field: null, expiresAt: Date.now() + 30_000 });
    return null;
  }
}

async function normalizeContacts(items: Record<string, unknown>[]): Promise<GhlContact[]> {
  const statusField = validValue(env.ghlContactStatusFieldKey) ? await getGhlContactStatusField() : null;
  const fieldId = typeof statusField?.id === "string" ? statusField.id : "";
  return items
    .map((item) => normalizeGhlContact(item, fieldId, env.ghlOpenStatusValue, env.ghlContactStatusFieldKey))
    .filter((contact) => contact.id.length > 0);
}

export async function listGhlContactsPage({
  cursor,
  limit = 100,
  signal,
}: {
  cursor?: GhlCursor | null;
  limit?: number;
  signal?: AbortSignal;
} = {}): Promise<GhlContactPage> {
  const configIssue = getGhlConfigurationIssue();
  if (configIssue) return { contacts: [], blocked: true, blocker: configIssue, nextCursor: null, total: null };

  const endpoint = new URL(`${GHL_API_BASE_URL}/contacts/`);
  endpoint.searchParams.set("locationId", env.ghlLocationId);
  endpoint.searchParams.set("limit", String(Math.min(Math.max(limit, 1), 100)));
  if (cursor?.startAfter) endpoint.searchParams.set("startAfter", cursor.startAfter);
  if (cursor?.startAfterId) endpoint.searchParams.set("startAfterId", cursor.startAfterId);

  try {
    const response = await fetch(endpoint, { headers: buildHeaders(), cache: "no-store", signal });
    if (!response.ok) {
      return { contacts: [], blocked: true, blocker: `GHL contact list request failed with HTTP ${response.status}.`, nextCursor: null, total: null };
    }

    const payload: unknown = await response.json();
    const contacts = await normalizeContacts(extractGhlContacts(payload));
    const pagination = extractGhlPagination(payload);
    const nextCursor = pagination.startAfter && pagination.startAfterId ? pagination : null;
    return { contacts, blocked: false, nextCursor, total: extractGhlTotal(payload) };
  } catch {
    return {
      contacts: [],
      blocked: true,
      blocker: signal?.aborted ? "GHL contact request timed out." : "GHL contact list request could not be completed.",
      nextCursor: null,
      total: null,
    };
  }
}

export async function listOpenContactsForAgent({
  assignedUserId,
  limit = 25,
  cursor,
}: {
  assignedUserId: string;
  limit?: number;
  cursor?: GhlCursor | null;
}): Promise<AgentContactQueueResult> {
  if (!assignedUserId.trim()) {
    return { contacts: [], blocked: true, blocker: "Your GHL user mapping is not configured.", nextCursor: null, hasMore: false, total: null };
  }
  const configIssue = getGhlConfigurationIssue(true);
  if (configIssue) return { contacts: [], blocked: true, blocker: configIssue, nextCursor: null, hasMore: false, total: null };

  const page = await listGhlContactsPage({ cursor, limit: Math.min(Math.max(limit, 1), 100) });
  if (page.blocked) return { contacts: [], blocked: true, blocker: page.blocker ?? "Assigned contacts could not be loaded.", nextCursor: null, hasMore: false, total: null };

  const contacts = page.contacts
    .filter((contact) => contact.isOpen && contact.assignedUserId === assignedUserId)
    .slice(0, limit)
    .map((contact) => toAgentContact(contact));
  return { contacts, blocked: false, nextCursor: page.nextCursor, hasMore: page.nextCursor !== null, total: page.total };
}

export async function getOpenContactForAgent(contactId: string, assignedUserId: string): Promise<GhlContact | null> {
  if (!contactId.trim() || !assignedUserId.trim()) return null;
  const contact = await getGhlContact(contactId);
  if (!contact || !contact.isOpen || contact.assignedUserId !== assignedUserId) return null;
  return contact;
}

export async function getGhlContact(contactId: string): Promise<GhlContact | null> {
  if (getGhlConfigurationIssue()) return null;
  try {
    const response = await fetch(`${GHL_API_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
      headers: buildHeaders(),
      cache: "no-store",
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    const contact = contactFromPayload(payload);
    if (!contact) return null;
    return (await normalizeContacts([contact]))[0] ?? null;
  } catch {
    return null;
  }
}

export async function updateGhlContact(contactId: string, mutation: GhlContactMutation): Promise<{ ok: boolean; reason?: string }> {
  const needsStatus = mutation.status !== undefined;
  const configIssue = getGhlConfigurationIssue(needsStatus);
  if (configIssue) return { ok: false, reason: configIssue };
  if (mutation.assignedTo === undefined && mutation.status === undefined && !mutation.customFields?.length) return { ok: false, reason: "No contact change was supplied." };
  if (mutation.customFields?.some((field) => !field.id.trim() || !field.key.trim() || field.fieldValue.length > 5000)) {
    return { ok: false, reason: "A configured contact custom field is invalid." };
  }
  if (mutation.status !== undefined && (!mutation.status.trim() || mutation.status.trim().length > 80)) {
    return { ok: false, reason: "Status must contain 1 to 80 characters." };
  }

  const body: Record<string, unknown> = {};
  if (mutation.assignedTo !== undefined) body.assignedTo = mutation.assignedTo;
  if (mutation.status !== undefined) {
    const field = await getGhlContactStatusField();
    if (typeof field?.id !== "string" || !field.id) {
      return { ok: false, reason: "The configured status field key was not found in this location's contact custom fields." };
    }
    body.customFields = [{ id: field.id, fieldValue: mutation.status.trim() }];
  }
  if (mutation.customFields?.length) body.customFields = [...(Array.isArray(body.customFields) ? body.customFields : []), ...mutation.customFields];

  try {
    const response = await fetch(`${GHL_API_BASE_URL}/contacts/${encodeURIComponent(contactId)}`, {
      method: "PUT",
      headers: buildHeaders(true),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: `GHL update failed with HTTP ${response.status}.` };
    const payload: unknown = await response.json().catch(() => ({}));
    if (payload && typeof payload === "object" && (payload as Record<string, unknown>).succeeded === false) {
      return { ok: false, reason: "GHL reported that the contact update did not succeed." };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "GHL contact update could not be completed." };
  }
}

export async function syncGhlManualCall(contactId: string, stage: CallStage, note: string, callbackAt: string | null): Promise<GhlCallSyncResult> {
  if (!env.ghlCallStageFieldKey.trim() || !env.ghlCallNotesFieldKey.trim()) {
    return { status: "not_configured", reason: "Set GHL_CALL_STAGE_FIELD_KEY and GHL_CALL_NOTES_FIELD_KEY after creating those contact fields." };
  }
  if (stage === "call-later" && !env.ghlCallbackAtFieldKey.trim()) {
    return { status: "not_configured", reason: "Set GHL_CALLBACK_AT_FIELD_KEY to sync the scheduled callback time." };
  }

  const [stageField, notesField, callbackField] = await Promise.all([
    getGhlContactCustomField(env.ghlCallStageFieldKey),
    getGhlContactCustomField(env.ghlCallNotesFieldKey),
    env.ghlCallbackAtFieldKey.trim() ? getGhlContactCustomField(env.ghlCallbackAtFieldKey) : Promise.resolve(null),
  ]);
  const fieldInfo = (field: Record<string, unknown> | null, fallbackKey: string) => {
    const id = typeof field?.id === "string" ? field.id : "";
    const key = typeof field?.key === "string" ? field.key : typeof field?.fieldKey === "string" ? field.fieldKey : fallbackKey;
    return id && key ? { id, key } : null;
  };
  const stageInfo = fieldInfo(stageField, env.ghlCallStageFieldKey);
  const notesInfo = fieldInfo(notesField, env.ghlCallNotesFieldKey);
  const callbackInfo = env.ghlCallbackAtFieldKey.trim() ? fieldInfo(callbackField, env.ghlCallbackAtFieldKey) : null;
  if (!stageInfo || !notesInfo || (env.ghlCallbackAtFieldKey.trim() && !callbackInfo)) {
    return { status: "failed", reason: "One or more configured GHL call fields could not be found in this location." };
  }

  const stageLabels: Record<CallStage, string> = {
    picked: "Picked",
    "not-picked": "Not picked",
    "call-later": "Call later",
    busy: "Busy",
    interested: "Interested",
  };
  const customFields = [
    { ...stageInfo, fieldValue: stageLabels[stage] },
    { ...notesInfo, fieldValue: note.trim() },
  ];
  if (callbackInfo) customFields.push({ ...callbackInfo, fieldValue: callbackAt ?? "" });

  const result = await updateGhlContact(contactId, { customFields });
  return result.ok
    ? { status: "synced" }
    : { status: "failed", reason: result.reason ?? "GHL contact update failed." };
}
