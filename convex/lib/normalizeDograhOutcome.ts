import type {
  BusinessOutcomeCustomField,
  BusinessOutcomeFields,
  BusinessOutcomeType,
  NormalizedBusinessOutcome,
} from "../../lib/contracts/businessOutcome";
import { BUSINESS_OUTCOME_VERSION } from "../../lib/contracts/businessOutcome";

export const OUTCOME_VERSION = BUSINESS_OUTCOME_VERSION;
export type OutcomeType = BusinessOutcomeType;
export type NormalizedOutcome = NormalizedBusinessOutcome;

const MAX_CUSTOM_FIELDS = 20;
const MAX_CUSTOM_KEY = 64;
const MAX_CUSTOM_VALUE = 512;
const MAX_RAW_DEPTH = 6;
const MAX_RAW_NODES = 100;
const MAX_RAW_STRING = 2_048;
const MAX_RAW_BYTES = 32 * 1024;
const SECRET_KEY = /(secret|token|authorization|api[_-]?key|password|cookie|signature|credential|private[_-]?key)/i;
const SAFE_CUSTOM_KEY = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;
const TRUE_VALUES = new Set(["true", "yes", "1", "y", "confirmed"]);
const FALSE_VALUES = new Set(["false", "no", "0", "n", "unknown", "null", ""]);

function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (TRUE_VALUES.has(normalized)) return true;
    if (FALSE_VALUES.has(normalized)) return false;
  }
  return undefined;
}

function asString(value: unknown, max = MAX_CUSTOM_VALUE): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized.slice(0, max) : undefined;
}

function firstValue(source: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== null && source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}

function parseContext(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function flattenContext(raw: Record<string, unknown>): Record<string, unknown> {
  const gathered = parseContext(raw.gathered_context);
  const extracted = parseContext(raw.extracted_variables);
  const gatheredExtracted = parseContext(gathered.extracted_variables);
  // Direct canonical fields win over aliases; extracted variables are still accepted
  // because the Dograh renderer emits them as a nested object of strings.
  return { ...gatheredExtracted, ...extracted, ...gathered, ...raw };
}

function addCustomField(fields: BusinessOutcomeCustomField[], key: string, value: unknown) {
  if (fields.length >= MAX_CUSTOM_FIELDS || !SAFE_CUSTOM_KEY.test(key) || SECRET_KEY.test(key)) return;
  if (["gathered_context", "extracted_variables", "initial_context", "annotations", "cost_info"].includes(key)) return;
  let stringValue: string | undefined;
  if (typeof value === "string") stringValue = value.trim().slice(0, MAX_CUSTOM_VALUE);
  else if (typeof value === "number" || typeof value === "boolean") stringValue = String(value);
  if (stringValue) fields.push({ key: key.slice(0, MAX_CUSTOM_KEY), value: stringValue });
}

export function normalizeDograhContext(raw: Record<string, unknown>): NormalizedOutcome {
  const source = flattenContext(raw ?? {});
  const fields: BusinessOutcomeFields = { bookingConfirmed: false };
  const customFields: BusinessOutcomeCustomField[] = [];

  const resolution = asString(firstValue(source, ["resolution", "call_disposition", "lead_status"]));
  if (resolution) fields.resolution = resolution.toLowerCase();

  const reached = asBool(firstValue(source, ["reached", "call_reached"]));
  const resolutionReached = resolution ? ["reached", "connected", "answered"].includes(resolution.toLowerCase()) : undefined;
  if (reached !== undefined || resolutionReached !== undefined) fields.reached = reached ?? resolutionReached;
  fields.qualified = asBool(firstValue(source, ["qualified", "is_qualified"]));
  fields.bookingRequested = asBool(firstValue(source, ["booking_requested", "appointment_requested", "wants_booking", "customer_wants_booking"]));
  // Dograh extraction is evidence of a request, never calendar confirmation.
  fields.handoffRequested = asBool(firstValue(source, ["handoff_requested", "handoff_required", "human_handoff"]));
  fields.quoteRequested = asBool(firstValue(source, ["quote_requested", "pricing_requested"]));
  fields.paymentPromise = asBool(firstValue(source, ["payment_promise", "payment_promised", "promised"]));
  fields.dispute = asBool(firstValue(source, ["dispute", "complaint"]));
  fields.followUpRequired = asBool(firstValue(source, ["follow_up_required", "followup_required"]));
  fields.sentiment = asString(firstValue(source, ["sentiment"]), 128)?.toLowerCase();
  fields.summary = asString(firstValue(source, ["summary", "call_summary", "conversation_summary"]));

  for (const [key, value] of Object.entries(source)) {
    if (!["resolution", "call_disposition", "lead_status", "reached", "call_reached", "qualified", "is_qualified", "booking_requested", "appointment_requested", "wants_booking", "customer_wants_booking", "booking_confirmed", "handoff_requested", "handoff_required", "human_handoff", "quote_requested", "pricing_requested", "payment_promise", "payment_promised", "promised", "dispute", "complaint", "follow_up_required", "followup_required", "sentiment", "summary", "call_summary", "conversation_summary"].includes(key)) {
      addCustomField(customFields, key, value);
    }
  }

  return {
    version: OUTCOME_VERSION,
    outcomeType: classifyOutcome(fields),
    fields,
    customFields,
  };
}

function classifyOutcome(fields: BusinessOutcomeFields): BusinessOutcomeType {
  if (fields.bookingRequested) return "booking_requested";
  if (fields.dispute) return "dispute";
  if (fields.handoffRequested) return "human_handoff_requested";
  if (fields.quoteRequested) return "quote_requested";
  if (fields.paymentPromise) return "payment_promised";
  if (fields.qualified) return "qualified";
  if (fields.reached) return "reached";
  if (fields.followUpRequired) return "follow_up_required";
  return "no_outcome";
}

export function outcomeIsHandoff(type: OutcomeType): boolean {
  return type === "human_handoff_requested" || type === "dispute" || type === "follow_up_required";
}

export function sanitizeDograhValue(value: unknown, depth = 0, state = { nodes: 0, bytes: 0 }): unknown {
  if (depth > MAX_RAW_DEPTH) throw new Error("Dograh context depth exceeds bound");
  state.nodes += 1;
  if (state.nodes > MAX_RAW_NODES) throw new Error("Dograh context node count exceeds bound");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    const result = value.slice(0, MAX_RAW_STRING);
    state.bytes += new TextEncoder().encode(result).byteLength;
    if (state.bytes > MAX_RAW_BYTES) throw new Error("Dograh context exceeds byte bound");
    return result;
  }
  if (Array.isArray(value)) return value.map((item) => sanitizeDograhValue(item, depth + 1, state));
  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY.test(key)) continue;
      result[key.slice(0, MAX_CUSTOM_KEY)] = sanitizeDograhValue(child, depth + 1, state);
    }
    return result;
  }
  return undefined;
}

export function sanitizeDograhJson(value: unknown): string {
  const sanitized = sanitizeDograhValue(value);
  const json = JSON.stringify(sanitized);
  if (new TextEncoder().encode(json).byteLength > MAX_RAW_BYTES) throw new Error("Dograh context exceeds byte bound");
  return json;
}

export const DOGRAH_RAW_CONTEXT_LIMIT = MAX_RAW_BYTES;
