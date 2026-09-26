/** Default country calling code applied to numbers entered without a leading "+". */
export const DEFAULT_CALLING_CODE = "91";

/**
 * Normalize a human-entered phone number to E.164 (`+<digits>`).
 * Dograh campaigns reject numbers without a country code, so bare local
 * numbers get the default calling code. Returns null when unusable.
 */
export function normalizePhone(raw: string, defaultCallingCode = DEFAULT_CALLING_CODE): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let digits = trimmed.replace(/[^\d]/g, "");
  if (trimmed.startsWith("+")) {
    // already international
  } else if (trimmed.startsWith("00")) {
    digits = digits.slice(2);
  } else {
    digits = digits.replace(/^0+/, "");
    if (digits.length <= 10) digits = `${defaultCallingCode}${digits}`;
  }
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Split an E.164 number into Twenty's calling-code + national-number shape. */
export function splitForTwenty(e164: string, defaultCallingCode = DEFAULT_CALLING_CODE) {
  const digits = e164.replace(/^\+/, "");
  const code = digits.startsWith(defaultCallingCode) && digits.length - defaultCallingCode.length === 10
    ? defaultCallingCode
    : digits.length > 10
      ? digits.slice(0, digits.length - 10)
      : "";
  return { callingCode: code ? `+${code}` : "", number: digits.slice(code.length) };
}
