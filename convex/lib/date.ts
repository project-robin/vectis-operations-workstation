import type { OrganizationPolicy } from "../../lib/contracts/organizationSettings";

export type DatePolicy = Pick<OrganizationPolicy, "timezone"> | string;

function timezoneOf(policy: DatePolicy): string { return typeof policy === "string" ? policy : policy.timezone; }

function parts(ms: number, timezone: string) {
  const values = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => Number(values.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"), second: get("second") };
}

function offsetAt(ms: number, timezone: string) {
  const value = parts(ms, timezone);
  return Date.UTC(value.year, value.month - 1, value.day, value.hour, value.minute, value.second) - Math.floor(ms / 1000) * 1000;
}

/** Convert an unambiguous local wall-clock time to an instant, including DST transitions. */
export function organizationLocalTimestamp(local: { year: number; month: number; day: number; hour?: number; minute?: number; second?: number }, policy: DatePolicy): number {
  const timezone = timezoneOf(policy);
  let guess = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0, local.second ?? 0);
  for (let i = 0; i < 4; i += 1) guess = Date.UTC(local.year, local.month - 1, local.day, local.hour ?? 0, local.minute ?? 0, local.second ?? 0) - offsetAt(guess, timezone);
  return guess;
}

// Date windows are evaluated in the organization's IANA timezone, never the host timezone.
export function dateKey(ms: number, policy: DatePolicy): string {
  const value = parts(ms, timezoneOf(policy));
  return `${String(value.year).padStart(4, "0")}-${String(value.month).padStart(2, "0")}-${String(value.day).padStart(2, "0")}`;
}

export function dateKeyForOrganization(ms: number, policy: Pick<OrganizationPolicy, "timezone">): string { return dateKey(ms, policy); }
export function monthKey(ms: number, policy: DatePolicy): string { return dateKey(ms, policy).slice(0, 7); }

export function startOfOrganizationDay(ms: number, policy: DatePolicy): number {
  const value = parts(ms, timezoneOf(policy));
  return organizationLocalTimestamp({ year: value.year, month: value.month, day: value.day }, policy);
}

export function startOfNextOrganizationDay(ms: number, policy: DatePolicy): number {
  const value = parts(ms, timezoneOf(policy));
  const next = new Date(Date.UTC(value.year, value.month - 1, value.day + 1));
  return organizationLocalTimestamp({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }, policy);
}

export function organizationDateRange(startMs: number, endMs: number, policy: DatePolicy) {
  return { startAt: startOfOrganizationDay(startMs, policy), endAt: startOfNextOrganizationDay(endMs - 1, policy) };
}

export function startOfMonthTimestamp(ms: number, policy: DatePolicy): number {
  const value = parts(ms, timezoneOf(policy));
  return organizationLocalTimestamp({ year: value.year, month: value.month, day: 1 }, policy);
}

export function isValidTimezone(timezone: string): boolean { try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); return true; } catch { return false; } }
