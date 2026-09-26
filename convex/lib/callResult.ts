/** Pure mapping from a Dograh workflow run to the Vectis call projection. */

export type CallResultStatus = "in_progress" | "completed" | "no_answer" | "failed";

export type CallResult = {
  status: CallResultStatus;
  disposition?: string;
  durationSeconds?: number;
  summary?: string;
  answers?: string;
  followUpRequired?: boolean;
  extracted?: string;
  recordingUrl?: string;
  transcriptUrl?: string;
  error?: string;
};

// Telephony-level outcomes where nobody picked up.
const UNREACHED = new Set(["no-answer", "no_answer", "busy", "canceled", "cancelled", "voicemail"]);
const FAILED = new Set(["failed", "error", "pipeline_error"]);
// Bookkeeping keys Dograh writes into gathered_context that are not extraction output.
const SYSTEM_KEYS = new Set([
  "nodes_visited",
  "call_status",
  "call_disposition",
  "mapped_call_disposition",
  "call_tags",
  "trace_url",
  "extracted_variables",
  "error",
  "provider",
  "triggered_by",
  "call_id",
  "trigger_uuid",
  "agent_visits",
  "campaign_id",
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown, max = 8000): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed && trimmed.toLowerCase() !== "none" && trimmed.toLowerCase() !== "null" ? trimmed.slice(0, max) : undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return text(value.map((item) => (typeof item === "string" ? item : JSON.stringify(item))).join("\n"), max);
  if (value && typeof value === "object") return JSON.stringify(value).slice(0, max);
  return undefined;
}

/** Dograh templating can deliver booleans as strings ("True", "yes"). */
export function looseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(v)) return true;
  if (["false", "no", "n", "0"].includes(v)) return false;
  return undefined;
}

function duration(run: Record<string, unknown>): number | undefined {
  for (const source of [record(run.cost_info), record(run.usage_info)]) {
    const value = source.call_duration_seconds;
    if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, Math.round(value));
  }
  return undefined;
}

export function mapDograhRun(runValue: unknown): CallResult {
  const run = record(runValue);
  if (run.is_completed !== true) return { status: "in_progress" };

  const gathered = record(run.gathered_context);
  // Prefer Dograh's explicit extraction output; older runs only carry the flattened keys.
  const extractedVars: Record<string, unknown> = { ...record(gathered.extracted_variables) };
  if (Object.keys(extractedVars).length === 0) {
    for (const [key, value] of Object.entries(gathered)) {
      if (!SYSTEM_KEYS.has(key)) extractedVars[key] = value;
    }
  }
  const disposition =
    text(gathered.mapped_call_disposition, 64) ?? text(gathered.call_disposition, 64) ?? text(gathered.call_status, 64);
  const normalized = disposition?.toLowerCase();
  const durationSeconds = duration(run);
  const error = text(gathered.error, 500);

  let status: CallResultStatus = "completed";
  if (normalized && UNREACHED.has(normalized)) status = "no_answer";
  else if (error || (normalized && FAILED.has(normalized) && !durationSeconds)) status = "failed";

  const extracted = Object.keys(extractedVars).length > 0 ? JSON.stringify(extractedVars).slice(0, 20_000) : undefined;
  return {
    status,
    disposition,
    durationSeconds,
    summary: text(extractedVars.call_summary) ?? text(extractedVars.summary),
    answers: text(extractedVars.answers) ?? text(extractedVars.questions_and_answers),
    followUpRequired: looseBoolean(extractedVars.follow_up_required),
    extracted,
    recordingUrl: text(run.recording_public_url, 2000),
    transcriptUrl: text(run.transcript_public_url, 2000),
    error,
  };
}

/** Human-readable outcome label used by the dashboard and CRM notes. */
export function outcomeLabel(status: string, disposition?: string): string {
  if (status === "no_answer") return "No answer";
  if (status === "failed") return "Call failed";
  if (status === "queued") return "Queued";
  if (status === "in_progress") return "In progress";
  switch (disposition?.toLowerCase()) {
    case "not_interested":
      return "Not interested";
    case "user_hangup":
      return "Hung up";
    case "busy_callback":
      return "Call back later";
    case "meeting_preferences_collected":
      return "Meeting requested";
    default:
      return "Completed";
  }
}
