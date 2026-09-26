export type CampaignBusinessStatus = "draft" | "approved" | "starting" | "running" | "pausing" | "paused" | "resuming" | "failed" | "completed" | "reconciliation_required";
export type Transition = "start" | "pause" | "resume";
export type CsvMember = { workstationRunId: string; sourceRowId: string; providerRunId?: string; name: string; phone: string; consent: "consented" };

const LEGAL: Record<CampaignBusinessStatus, Partial<Record<Transition, CampaignBusinessStatus>>> = {
  draft: {},
  approved: { start: "starting" },
  starting: {}, running: { pause: "pausing" }, pausing: {},
  paused: { resume: "resuming" }, resuming: {},
  failed: {}, completed: {}, reconciliation_required: {},
};
const TERMINAL = new Set(["completed", "complete", "ended", "failed", "cancelled", "canceled", "terminated", "stopped"]);
const MAX_ROWS = 500;

export function canonicalBusinessStatus(row: { businessStatus?: CampaignBusinessStatus; status?: CampaignBusinessStatus }): CampaignBusinessStatus {
  return row.businessStatus ?? row.status ?? "draft";
}
export function campaignTransition(current: CampaignBusinessStatus, next: CampaignBusinessStatus): CampaignBusinessStatus {
  if (current === next) return current;
  if (next === "starting" && LEGAL[current]?.start) return next;
  if (next === "pausing" && LEGAL[current]?.pause) return next;
  if (next === "resuming" && LEGAL[current]?.resume) return next;
  if (current === "completed" || current === "failed" || current === "reconciliation_required") throw new Error(`Illegal transition from terminal ${current}`);
  throw new Error(`Illegal campaign transition from ${current} to ${next}`);
}
export function providerStateIsTerminal(value: string | undefined): boolean {
  return typeof value === "string" && TERMINAL.has(value.trim().toLowerCase());
}
export function providerStateIsStopped(value: string | undefined): boolean {
  return providerStateIsTerminal(value);
}
function csv(value: string) { return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value; }
export function buildCampaignCsv(members: CsvMember[]): string {
  if (members.length < 1 || members.length > MAX_ROWS) throw new Error(`Campaign rows must be between 1 and ${MAX_ROWS}`);
  const output = ["workstation_provider_run_id,source_row_id,name,phone"];
  for (const member of members) {
    if (member.consent !== "consented" || !member.workstationRunId || !member.sourceRowId || !member.phone) throw new Error("Only consented valid campaign members may be uploaded");
    output.push([member.workstationRunId, member.sourceRowId, member.name, member.phone].map(csv).join(","));
  }
  const text = `${output.join("\n")}\n`;
  if (new TextEncoder().encode(text).byteLength > 10 * 1024 * 1024) throw new Error("Campaign CSV exceeds size bound");
  return text;
}
export const campaignLimits = Object.freeze({ maxRows: MAX_ROWS, maxCsvBytes: 10 * 1024 * 1024 });
