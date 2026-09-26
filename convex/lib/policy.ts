import type { OrganizationPolicy } from "../../lib/contracts/organizationSettings";

const ISO_CURRENCY = /^[A-Z]{3}$/;
const MAX_ATTRIBUTION_HOURS = 30 * 24;
const MAX_HEALTH_MINUTES = 7 * 24 * 60;
const SECRET_SHAPED_KEY = /(secret|token|password|credential|api[-_]?key|private[-_]?key)/i;

export const DEFAULT_ORGANIZATION_POLICY: OrganizationPolicy = {
  timezone: "UTC",
  defaultCurrency: "INR",
  attributionWindow: {
    value: 30,
    unit: "days",
    semantics: "interaction_to_outcome",
  },
  expectedBookingValuePolicy: { mode: "opportunity" },
  commercialMetricsMode: "shadow",
  bookingAuthorityPolicy: { sourceType: "twenty", requireReadback: true },
  paymentAuthorityPolicy: { sourceTypes: ["twenty"], requireReadback: true },
  recoveryPolicy: {
    enabled: true,
    window: { value: 30, unit: "days" },
    priorStateTypes: ["missed", "stale", "no_show", "overdue"],
  },
  healthFreshnessPolicy: { warningAfterMinutes: 15, criticalAfterMinutes: 60 },
};

export function assertTimezone(timezone: string): void {
  if (typeof timezone !== "string" || timezone.length === 0 || timezone.length > 100) {
    throw new Error("Invalid IANA timezone");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
  } catch {
    throw new Error(`Invalid IANA timezone: ${timezone}`);
  }
}

export function assertCurrency(currency: string): void {
  if (!ISO_CURRENCY.test(currency)) throw new Error(`Invalid ISO 4217 currency: ${currency}`);
  const supported = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("currency") : [];
  if (supported.length > 0 && !supported.includes(currency)) {
    throw new Error(`Unsupported ISO 4217 currency: ${currency}`);
  }
}

export function currencyMinorDigits(currency: string): number {
  assertCurrency(currency);
  return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

export function assertMinorAmount(amountMinor: number, currency: string): void {
  assertCurrency(currency);
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new Error("Amount must be a non-negative safe integer of minor units");
  }
}

export function assertAttributionWindow(window: OrganizationPolicy["attributionWindow"]): void {
  if (!Number.isSafeInteger(window.value) || window.value < 1) {
    throw new Error("Attribution window value must be a positive integer");
  }
  const hours = window.unit === "days" ? window.value * 24 : window.value;
  if (hours > MAX_ATTRIBUTION_HOURS) {
    throw new Error(`Invalid attribution window: cannot exceed ${MAX_ATTRIBUTION_HOURS} hours`);
  }
  if (window.semantics !== "interaction_to_outcome") {
    throw new Error("Attribution window semantics are invalid");
  }
}

export function assertExpectedBookingValuePolicy(policy: OrganizationPolicy["expectedBookingValuePolicy"]): void {
  if (policy.mode === "none" || policy.mode === "opportunity") {
    if (policy.amountMinor !== undefined || policy.currency !== undefined || policy.serviceValues !== undefined) {
      throw new Error("Expected booking value policy cannot contain an amount");
    }
    return;
  }
  if (policy.mode === "org_wide") {
    if (policy.amountMinor === undefined || policy.currency === undefined) {
      throw new Error("org_wide expected booking value policy requires amountMinor and currency");
    }
    assertMinorAmount(policy.amountMinor, policy.currency);
    if (policy.serviceValues !== undefined) throw new Error("org_wide policy cannot contain service values");
    return;
  }
  if (!policy.serviceValues || policy.serviceValues.length === 0) {
    throw new Error("service expected booking value policy requires service values");
  }
  if (policy.amountMinor !== undefined || policy.currency !== undefined) {
    throw new Error("service policy uses service values instead of a single amount");
  }
  const services = new Set<string>();
  for (const value of policy.serviceValues) {
    if (value.service.length === 0 || value.service.length > 100 || services.has(value.service)) {
      throw new Error("Service expected booking values must have unique non-empty service names");
    }
    services.add(value.service);
    assertMinorAmount(value.amountMinor, value.currency);
  }
}

export function assertHealthFreshnessPolicy(policy: OrganizationPolicy["healthFreshnessPolicy"]): void {
  const { warningAfterMinutes, criticalAfterMinutes } = policy;
  if (
    !Number.isSafeInteger(warningAfterMinutes) ||
    !Number.isSafeInteger(criticalAfterMinutes) ||
    warningAfterMinutes < 1 ||
    criticalAfterMinutes < warningAfterMinutes ||
    criticalAfterMinutes > MAX_HEALTH_MINUTES
  ) {
    throw new Error("Health freshness bounds are invalid");
  }
}

export function assertCommercialPolicy(policy: Pick<OrganizationPolicy, "commercialMetricsMode" | "bookingAuthorityPolicy" | "paymentAuthorityPolicy" | "recoveryPolicy">): void {
  if (!["shadow", "published"].includes(policy.commercialMetricsMode)) throw new Error("Commercial metrics mode is invalid");
  if (!policy.bookingAuthorityPolicy.sourceType || policy.bookingAuthorityPolicy.sourceType.length > 100) throw new Error("Booking authority source is invalid");
  if (!policy.paymentAuthorityPolicy.sourceTypes.length || policy.paymentAuthorityPolicy.sourceTypes.some((value) => !value || value.length > 100)) throw new Error("Payment authority sources are invalid");
  const recovery = policy.recoveryPolicy;
  if (!Number.isSafeInteger(recovery.window.value) || recovery.window.value < 1 || recovery.window.value > 720) throw new Error("Recovery window is invalid");
  if (!recovery.priorStateTypes.length || new Set(recovery.priorStateTypes).size !== recovery.priorStateTypes.length) throw new Error("Recovery prior states are invalid");
}

export function assertOrganizationPolicy(policy: OrganizationPolicy): void {
  assertTimezone(policy.timezone);
  assertCurrency(policy.defaultCurrency);
  assertAttributionWindow(policy.attributionWindow);
  assertExpectedBookingValuePolicy(policy.expectedBookingValuePolicy);
  assertCommercialPolicy(policy);
  assertHealthFreshnessPolicy(policy.healthFreshnessPolicy);
  if (policy.businessVertical !== undefined && (policy.businessVertical.length === 0 || policy.businessVertical.length > 100)) {
    throw new Error("Business vertical must be between 1 and 100 characters");
  }
}

export function assertMetadataSafe(metadata?: Array<{ key: string; value: string }>): void {
  if (!metadata) return;
  const keys = new Set<string>();
  for (const entry of metadata) {
    if (entry.key.length === 0 || entry.key.length > 100 || keys.has(entry.key) || SECRET_SHAPED_KEY.test(entry.key)) {
      throw new Error("Integration metadata contains an invalid or secret-shaped key");
    }
    if (entry.value.length > 1000 || SECRET_SHAPED_KEY.test(entry.value)) {
      throw new Error("Integration metadata contains a secret-shaped value");
    }
    keys.add(entry.key);
  }
}

export function assertSecretReferences(names?: string[]): void {
  if (!names) return;
  const unique = new Set<string>();
  for (const name of names) {
    if (!/^[A-Z][A-Z0-9_.-]{0,127}$/.test(name) || unique.has(name)) {
      throw new Error("Secret references must be unique deployment reference names");
    }
    unique.add(name);
  }
}
