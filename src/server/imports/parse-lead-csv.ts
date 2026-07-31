import { parse } from "csv-parse/sync";
import { z } from "zod";

export type ImportRowClassification = "valid" | "blocked_consent" | "invalid" | "duplicate";

export interface ParsedLeadRow {
  rowNumber: number;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  originalPhone: string;
  normalizedPhone: string | null;
  consentStatus: string | null;
  classification: ImportRowClassification;
  reason: string | null;
}

export interface ParseLeadCsvOptions {
  defaultCallingCode: string;
}

function normalizePhone(value: string, defaultCallingCode: string): string | null {
  const compact = value.replace(/[\s().-]/g, "");
  let normalized: string;

  if (/^\+[1-9]\d{7,14}$/.test(compact)) {
    normalized = compact;
  } else if (/^00[1-9]\d{7,14}$/.test(compact)) {
    normalized = `+${compact.slice(2)}`;
  } else if (/^0\d{7,13}$/.test(compact) && /^[1-9]\d{0,2}$/.test(defaultCallingCode)) {
    normalized = `+${defaultCallingCode}${compact.slice(1)}`;
  } else {
    return null;
  }

  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : null;
}

function hasConsent(value: string | undefined): boolean {
  return new Set(["1", "consented", "opted_in", "true", "yes"]).has(
    value?.trim().toLowerCase() ?? "",
  );
}

export function parseLeadCsv(csv: string, options: ParseLeadCsvOptions) {
  const records = parse(csv, {
    bom: true,
    columns: (headers: string[]) =>
      headers.map((header) => header.trim().toLowerCase().replaceAll(" ", "_")),
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();

  const rows: ParsedLeadRow[] = records.map((record, index) => {
    const originalPhone = record.phone ?? record.phone_number ?? "";
    const normalizedPhone = normalizePhone(originalPhone, options.defaultCallingCode);
    const emailValue = record.email?.trim().toLowerCase() || null;
    const validEmail = emailValue === null || z.email().safeParse(emailValue).success;
    const duplicate =
      (normalizedPhone !== null && seenPhones.has(normalizedPhone)) ||
      (emailValue !== null && seenEmails.has(emailValue));

    if (normalizedPhone !== null) {
      seenPhones.add(normalizedPhone);
    }
    if (emailValue !== null) {
      seenEmails.add(emailValue);
    }

    let classification: ImportRowClassification = "valid";
    let reason: string | null = null;

    if (normalizedPhone === null || !validEmail) {
      classification = "invalid";
      reason = normalizedPhone === null ? "Invalid phone number" : "Invalid email address";
    } else if (duplicate) {
      classification = "duplicate";
      reason = "Duplicate phone or email in this import";
    } else if (!hasConsent(record.consent_status ?? record.consent)) {
      classification = "blocked_consent";
      reason = "Consent is absent or denied";
    }

    return {
      rowNumber: index + 2,
      firstName: record.first_name || null,
      lastName: record.last_name || null,
      email: emailValue,
      originalPhone,
      normalizedPhone,
      consentStatus: record.consent_status ?? record.consent ?? null,
      classification,
      reason,
    };
  });

  return {
    rows,
    summary: {
      total: rows.length,
      valid: rows.filter((row) => row.classification === "valid").length,
      blockedConsent: rows.filter((row) => row.classification === "blocked_consent").length,
      invalid: rows.filter((row) => row.classification === "invalid").length,
      duplicate: rows.filter((row) => row.classification === "duplicate").length,
    },
  };
}
