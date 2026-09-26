/** Small RFC 4180 CSV parser for browser-side lead imports (quotes, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.replace(/^﻿/, "");
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell.trim() !== "")) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  row.push(field);
  if (row.some((cell) => cell.trim() !== "")) rows.push(row);
  return rows;
}

export type LeadField = "name" | "phone" | "email" | "notes";

const ALIASES: Record<LeadField, string[]> = {
  name: ["name", "full_name", "fullname", "contact_name", "customer_name", "customer", "patient_name", "patient", "clinic_name", "business_name", "company", "first_name"],
  phone: ["phone", "phone_number", "mobile", "mobile_number", "contact_number", "number", "whatsapp_phone", "whatsapp", "telephone", "tel", "cell"],
  email: ["email", "email_address", "e-mail", "mail"],
  notes: ["notes", "note", "comments", "comment", "description", "remarks"],
};

const normalize = (header: string) => header.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Best-guess column index for each lead field, or -1. */
export function guessColumns(headers: string[]): Record<LeadField, number> {
  const normalized = headers.map(normalize);
  const result = { name: -1, phone: -1, email: -1, notes: -1 } as Record<LeadField, number>;
  for (const field of Object.keys(ALIASES) as LeadField[]) {
    for (const alias of ALIASES[field]) {
      const index = normalized.indexOf(alias);
      if (index >= 0) {
        result[field] = index;
        break;
      }
    }
    if (result[field] < 0) {
      result[field] = normalized.findIndex((header) => ALIASES[field].some((alias) => header.includes(alias)));
    }
  }
  return result;
}
