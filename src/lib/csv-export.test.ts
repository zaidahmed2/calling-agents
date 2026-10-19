import { describe, expect, it } from "vitest";

import { toCsv } from "@/lib/csv-export";

describe("CSV exports", () => {
  it("escapes cells, emits an Excel-compatible UTF-8 BOM, and protects spreadsheet formulas", () => {
    const csv = toCsv([
      { name: 'Smith, "Alex"', note: "=HYPERLINK(\"https://bad.example\")" },
      { name: "Line one\nLine two", note: null },
    ], [
      { label: "Name", value: (row) => row.name },
      { label: "Notes", value: (row) => row.note },
    ]);

    expect(csv).toBe('\uFEFF"Name","Notes"\r\n"Smith, ""Alex""","\'=HYPERLINK(""https://bad.example"")"\r\n"Line one\nLine two",""');
  });
});
