export type CsvColumn<T> = {
  label: string;
  value: (row: T) => unknown;
};

function csvCell(value: unknown): string {
  let text = value === null || value === undefined
    ? ""
    : typeof value === "object" ? JSON.stringify(value) : String(value);
  if (/^[\t\r ]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [
    columns.map((column) => csvCell(column.label)).join(","),
    ...rows.map((row) => columns.map((column) => csvCell(column.value(row))).join(",")),
  ];
  return `\uFEFF${lines.join("\r\n")}`;
}
