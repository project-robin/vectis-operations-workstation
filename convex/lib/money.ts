import type { OrganizationPolicy } from "../../lib/contracts/organizationSettings";
import { assertCurrency, assertMinorAmount, currencyMinorDigits } from "./policy";

export function assertMinorUnit(amountMinor: number, currency: string): void {
  assertMinorAmount(amountMinor, currency);
}

export function minorFromMajor(major: string | number, currency: string): number {
  assertCurrency(currency);
  const n = typeof major === "string" ? Number(major) : major;
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid amount "${major}"`);
  const factor = 10 ** currencyMinorDigits(currency);
  const minor = Math.round(n * factor);
  assertMinorAmount(minor, currency);
  return minor;
}

export function formatMoney(amountMinor: number, currency: string): string {
  assertMinorAmount(amountMinor, currency);
  return new Intl.NumberFormat("en", { style: "currency", currency }).format(
    amountMinor / 10 ** currencyMinorDigits(currency),
  );
}

export function formatOrganizationMoney(
  amountMinor: number,
  policy: Pick<OrganizationPolicy, "defaultCurrency">,
): string {
  return formatMoney(amountMinor, policy.defaultCurrency);
}
