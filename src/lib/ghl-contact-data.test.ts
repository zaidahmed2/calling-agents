import { describe, expect, it } from "vitest";

import { extractGhlContacts, extractGhlPagination, normalizeGhlContact, resolveGhlStatusField, toAgentContact } from "./ghl-contact-data";

describe("GHL contact response parsing", () => {
  it("does not assume a missing custom-field status is Open", () => {
    const contact = normalizeGhlContact({ id: "c1", assignedTo: "u1" }, "status-field-id");
    expect(contact.status).toBeNull();
    expect(contact.isOpen).toBe(false);
  });

  it("reads status by configured field ID and assignment from assignedTo", () => {
    const contact = normalizeGhlContact({
      id: "c1",
      firstName: "Casey",
      lastName: "Lane",
      assignedTo: "ghl-user-1",
      phone: "0412345678",
      customFields: [
        { id: "other-field", value: "Ignore" },
        { id: "status-field-id", value: "Open" },
      ],
    }, "status-field-id");

    expect(contact.name).toBe("Casey Lane");
    expect(contact.status).toBe("Open");
    expect(contact.assignedUserId).toBe("ghl-user-1");
    expect(contact.isOpen).toBe(true);
    expect(contact.maskedPhone).toBe("••••••5678");
  });

  it("uses only the configured Open value and never a top-level status fallback", () => {
    const status = normalizeGhlContact({
      id: "c2",
      status: "Open",
      customFields: [{ id: "status-field-id", value: "Pending" }],
    }, "status-field-id", "Open");
    expect(status.status).toBe("Pending");
    expect(status.isOpen).toBe(false);
  });

  it("extracts contact arrays and pagination metadata without inventing cursors", () => {
    expect(extractGhlContacts({ contacts: [{ id: "one" }] })).toEqual([{ id: "one" }]);
    expect(extractGhlPagination({ meta: { startAfter: 100, startAfterId: "contact-100" } })).toEqual({ startAfter: "100", startAfterId: "contact-100" });
    expect(extractGhlPagination({})).toEqual({ startAfter: null, startAfterId: null });
  });

  it("resolves the custom-field ID from GHL metadata using the Liquid merge key", () => {
    const field = resolveGhlStatusField({
      data: { customFields: [{ id: "actual-field-id", fieldKey: "contact.status", name: "Status" }] },
    }, "{{contact.status}}");

    expect(field?.id).toBe("actual-field-id");
  });

  it("resolves call custom fields by their exact contact-prefixed GHL metadata keys", () => {
    const metadata = {
      customFields: [
        { id: "stage-id", fieldKey: "contact.call_stage", name: "Call Stage" },
        { id: "notes-id", fieldKey: "contact.call_notes", name: "Call Notes" },
        { id: "callback-id", fieldKey: "contact.callback_at", name: "Callback At" },
      ],
    };

    expect(resolveGhlStatusField(metadata, "contact.call_stage")?.id).toBe("stage-id");
    expect(resolveGhlStatusField(metadata, "contact.call_notes")?.id).toBe("notes-id");
    expect(resolveGhlStatusField(metadata, "contact.callback_at")?.id).toBe("callback-id");
  });

  it("uses a unique Status name when metadata omits the field key, but rejects ambiguous matches", () => {
    expect(resolveGhlStatusField({ customFields: [{ id: "status-id", name: "Status" }] }, "{{contact.status}}")?.id).toBe("status-id");
    expect(resolveGhlStatusField({ customFields: [{ id: "one", name: "Status" }, { id: "two", name: "Status" }] }, "{{contact.status}}")).toBeNull();
  });

  it("reads status by the configured GHL custom-field key when no field ID is present in the contact payload", () => {
    const contact = normalizeGhlContact({
      id: "key-status-contact",
      customFields: [{ key: "{{contact.status}}", fieldValue: "Follow Up" }],
    }, "", "Open", "{{contact.status}}");

    expect(contact.status).toBe("Follow Up");
    expect(contact.isOpen).toBe(false);
  });

  it("matches a normalized field key without Liquid braces", () => {
    const contact = normalizeGhlContact({
      id: "plain-key-status-contact",
      customFields: [{ fieldKey: "contact.status", value: "Open" }],
    }, "", "Open", "{{contact.status}}");

    expect(contact.status).toBe("Open");
    expect(contact.isOpen).toBe(true);
  });

  it("uses provider-supplied update timestamps without inventing activity", () => {
    const contact = normalizeGhlContact({ id: "dated", dateUpdated: "2026-10-09T12:30:00.000Z" }, "");
    const undated = normalizeGhlContact({ id: "undated" }, "");

    expect(contact.lastActivityAt).toBe("2026-10-09T12:30:00.000Z");
    expect(undated.lastActivityAt).toBeNull();
  });

  it("normalizes suburb from the contact city or an explicitly named suburb field", () => {
    expect(normalizeGhlContact({ id: "city", city: "Parramatta" }, "").suburb).toBe("Parramatta");
    expect(normalizeGhlContact({ id: "custom-suburb", customFields: [{ name: "Suburb", fieldValue: "Newtown" }] }, "").suburb).toBe("Newtown");
    expect(normalizeGhlContact({ id: "no-suburb" }, "").suburb).toBeNull();
  });

  it("projects legacy agent fields without sending email or the full number", () => {
    const source = normalizeGhlContact({ id: "agent-safe", name: "Ava Contact", email: "private@example.com", phone: "0400123456", city: "Newtown", assignedTo: "agent-1", customFields: [{ name: "Status", value: "Open" }] }, "status-id");
    const agentView = toAgentContact(source);

    expect(agentView).toEqual({ id: "agent-safe", name: "Ava Contact", phoneVisible: true, maskedPhone: "••••••3456", status: null, details: [], lastComment: null });
    expect(agentView).not.toHaveProperty("email");
    expect(agentView).not.toHaveProperty("phone");
    expect(JSON.stringify(agentView)).not.toContain("private@example.com");
    expect(JSON.stringify(agentView)).not.toContain("0400123456");
  });

  it("only includes specifically allowed CRM fields in the agent view", () => {
    const source = normalizeGhlContact({ id: "visibility", name: "Ava Contact", email: "ava@example.com", phone: "0400123456" }, "");
    const agentView = toAgentContact({
      ...source,
      subject: "Requested callback",
      notes: "Private note",
      customFields: { suburb: "Northside" },
    }, ["subject", "custom:suburb"]);

    expect(agentView.name).toBe("Contact");
    expect(agentView.phoneVisible).toBe(false);
    expect(agentView.maskedPhone).toBeNull();
    expect(agentView.status).toBeNull();
    expect(agentView.details).toEqual([
      { id: "subject", label: "Subject", value: "Requested callback" },
      { id: "custom:suburb", label: "suburb", value: "Northside" },
    ]);
    expect(JSON.stringify(agentView)).not.toContain("ava@example.com");
    expect(JSON.stringify(agentView)).not.toContain("0400123456");
    expect(JSON.stringify(agentView)).not.toContain("Private note");
  });
  it("does not reveal a full value when the phone contains four or fewer digits", () => {
    const source = normalizeGhlContact({ id: "short", phone: "1234" }, "");
    expect(source.maskedPhone).toBe("••••");
    expect(toAgentContact(source).maskedPhone).not.toContain("1234");
  });
});