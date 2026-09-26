/**
 * Build the CSV Dograh campaigns ingest. `phone_number` is required by Dograh;
 * every other column becomes a `{{template_variable}}` in the call's initial
 * context. `vectis_call_id` correlates each Dograh run back to our call row.
 */
export type CampaignCsvRow = {
  callId: string;
  phone: string;
  name?: string;
  email?: string;
};

const HEADERS = ["phone_number", "first_name", "name", "email", "business_name", "vectis_call_id"] as const;

function cell(value: string | undefined): string {
  const text = (value ?? "").replace(/[\r\n]+/g, " ").trim();
  // Neutralize spreadsheet formula injection before quoting.
  const safe = /^[=+\-@]/.test(text) && !/^\+\d/.test(text) ? `'${text}` : text;
  return /[",]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function buildCampaignCsv(rows: CampaignCsvRow[], businessName: string): string {
  const lines = [HEADERS.join(",")];
  for (const row of rows) {
    const name = row.name && row.name !== "Unknown" ? row.name : "";
    const firstName = name.split(/\s+/)[0] ?? "";
    lines.push([row.phone, firstName, name, row.email, businessName, row.callId].map(cell).join(","));
  }
  return `${lines.join("\n")}\n`;
}
