export type GhlCustomField = {
  id: string;
  name: string;
  type: string | null;
  metadata: Record<string, unknown>;
};

function records(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function firstString(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export function parseGhlCustomFields(payload: unknown): { fields: GhlCustomField[]; recognized: boolean } {
  const root = payload && typeof payload === "object" && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : {};
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? root.data as Record<string, unknown>
    : {};

  const sources = [root.customFields, root.fields, root.results, root.data, data.customFields, data.fields, data.results, data.data];
  const recognized = sources.some(Array.isArray);
  const fields = sources.flatMap(records);
  const normalized = new Map<string, GhlCustomField>();

  for (const field of fields) {
    const id = firstString(field, ["id", "fieldId", "field_id", "customFieldId", "custom_field_id"]);
    const name = firstString(field, ["name", "fieldName", "field_name", "label", "placeholder", "fieldKey", "field_key", "key"]) || id;
    if (!id || normalized.has(id)) continue;
    normalized.set(id, {
      id,
      name,
      type: firstString(field, ["dataType", "data_type", "fieldType", "field_type", "type"]) || null,
      metadata: field,
    });
  }

  return { fields: [...normalized.values()], recognized };
}
