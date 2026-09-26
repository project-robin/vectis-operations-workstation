import { outcomeLabel } from "./callResult";

export type CrmNoteInput = {
  kind: "campaign" | "quick";
  status: string;
  disposition?: string;
  contactName?: string;
  phone: string;
  brief?: string;
  summary?: string;
  answers?: string;
  extracted?: string;
  durationSeconds?: number;
  recordingUrl?: string;
  transcriptUrl?: string;
  transcript?: string;
  completedAt?: number;
  businessName: string;
};

function formatDuration(seconds?: number): string {
  if (seconds === undefined) return "unknown";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function displayValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (lowered === "true") return "Yes";
    if (lowered === "false") return "No";
    return value;
  }
  return JSON.stringify(value);
}

const MAX_NOTE_TRANSCRIPT = 6000;

/** Strip Dograh's per-line timestamps: "[2026-...] user: hi" -> "**Contact:** hi". */
function transcriptLines(transcript: string, contactName?: string): string {
  const text = transcript
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]*\]\s*/, "").trim())
    .filter(Boolean)
    .map((line) => line.replace(/^(assistant|bot|agent)\s*:\s*/i, "**Agent:** ").replace(/^(user|human)\s*:\s*/i, `**${contactName ?? "Contact"}:** `))
    .join("\n\n");
  return text.length > MAX_NOTE_TRANSCRIPT ? `${text.slice(0, MAX_NOTE_TRANSCRIPT)}\n\n…(truncated)` : text;
}

function extractedLines(extracted?: string): string[] {
  if (!extracted) return [];
  try {
    const values = JSON.parse(extracted) as Record<string, unknown>;
    return Object.entries(values)
      .filter(([key, value]) => !["call_summary", "answers"].includes(key) && value !== null && value !== "" && value !== undefined)
      .map(([key, value]) => `- **${key.replace(/_/g, " ")}**: ${displayValue(value)}`);
  } catch {
    return [];
  }
}

export function crmNoteTitle(input: CrmNoteInput): string {
  const date = new Date(input.completedAt ?? Date.now()).toISOString().slice(0, 10);
  const what = input.kind === "quick" ? "Custom call" : "Lead call";
  return `Vectis ${what} · ${outcomeLabel(input.status, input.disposition)} · ${date}`;
}

export function crmNoteMarkdown(input: CrmNoteInput): string {
  const lines = [
    `**Outcome:** ${outcomeLabel(input.status, input.disposition)}${input.disposition ? ` (${input.disposition})` : ""}`,
    `**Phone:** ${input.phone}`,
    `**Duration:** ${formatDuration(input.durationSeconds)}`,
    `**Placed by:** Vectis AI receptionist for ${input.businessName}`,
  ];
  if (input.brief) lines.push("", "### What we asked", input.brief);
  if (input.summary) lines.push("", "### Summary", input.summary);
  if (input.answers) lines.push("", "### Answers", input.answers);
  const details = extractedLines(input.extracted);
  if (details.length) lines.push("", "### Captured details", ...details);
  const links = [
    input.recordingUrl ? `[Recording](${input.recordingUrl})` : "",
    input.transcriptUrl ? `[Transcript](${input.transcriptUrl})` : "",
  ].filter(Boolean);
  if (links.length) lines.push("", links.join(" · "));
  if (input.transcript) lines.push("", "### Transcript", transcriptLines(input.transcript, input.contactName));
  return lines.join("\n");
}
