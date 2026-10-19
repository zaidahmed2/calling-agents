import { describe, expect, it } from "vitest";

import { parseGhlCustomFields } from "./ghl-fields";

describe("GHL custom field discovery parsing", () => {
  it("reads all fields from the documented location response", () => {
    const result = parseGhlCustomFields({
      customFields: [
        { id: "field-1", name: "First custom field", dataType: "TEXT" },
        { id: "field-2", fieldKey: "contact.pincode", placeholder: "Pin code", dataType: "TEXT" },
        { id: "field-3" },
      ],
    });

    expect(result.recognized).toBe(true);
    expect(result.fields.map(({ id, name, type }) => ({ id, name, type }))).toEqual([
      { id: "field-1", name: "First custom field", type: "TEXT" },
      { id: "field-2", name: "Pin code", type: "TEXT" },
      { id: "field-3", name: "field-3", type: null },
    ]);
  });

  it("handles nested field arrays and ignores duplicate IDs", () => {
    const result = parseGhlCustomFields({
      data: {
        fields: [
          { fieldId: "field-1", fieldName: "One" },
          { id: "field-1", name: "Duplicate" },
        ],
      },
    });

    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("One");
  });

  it("distinguishes an empty field list from an unrecognized response", () => {
    expect(parseGhlCustomFields({ customFields: [] })).toEqual({ fields: [], recognized: true });
    expect(parseGhlCustomFields({ message: "Unexpected response" })).toEqual({ fields: [], recognized: false });
  });
});
