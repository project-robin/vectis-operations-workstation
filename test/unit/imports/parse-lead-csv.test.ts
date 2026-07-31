import { describe, expect, it } from "vitest";
import { parseLeadCsv } from "../../../src/server/imports/parse-lead-csv.js";

describe("lead CSV parsing", () => {
  it("classifies valid, consent-blocked, invalid, and duplicate rows", () => {
    const csv = [
      "first_name,phone,email,consent_status",
      '"Lovelace, Ada",07700 900123,ada@example.com,yes',
      "Grace,+44 7700 900124,grace@example.com,no",
      "Bad,not-a-phone,bad@example.com,yes",
      "Duplicate,07700 900123,duplicate@example.com,yes",
    ].join("\n");

    const result = parseLeadCsv(csv, { defaultCallingCode: "44" });

    expect(result.summary).toEqual({
      total: 4,
      valid: 1,
      blockedConsent: 1,
      invalid: 1,
      duplicate: 1,
    });
    expect(result.rows).toMatchObject([
      {
        rowNumber: 2,
        firstName: "Lovelace, Ada",
        normalizedPhone: "+447700900123",
        classification: "valid",
      },
      { rowNumber: 3, classification: "blocked_consent" },
      { rowNumber: 4, classification: "invalid" },
      { rowNumber: 5, classification: "duplicate" },
    ]);
  });
});
