import { expect, test } from "vitest";
import { guessColumns, parseCsv } from "@/lib/csv";

test("parses quoted fields, escaped quotes, CRLF, and a BOM", () => {
  const rows = parseCsv('﻿name,phone\r\n"Rao, Asha","99"\r\n"Say ""hi""",88\n\n');
  expect(rows).toEqual([
    ["name", "phone"],
    ["Rao, Asha", "99"],
    ['Say "hi"', "88"],
  ]);
});

test("guesses lead columns from common header names", () => {
  expect(guessColumns(["Patient Name", "Mobile Number", "E-mail", "Remarks"])).toEqual({ name: 0, phone: 1, email: 2, notes: 3 });
  const clinic = guessColumns(["priority", "city", "clinic_name", "whatsapp_phone", "notes"]);
  expect(clinic).toMatchObject({ name: 2, phone: 3, notes: 4, email: -1 });
});
