// ponytail: pure functions, no Convex imports — trivial to unit test
// ponytail: no country inference for phones; add market policy when the first vertical is chosen

export function normalizePhone(raw?: string): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.replace(/[\s()\-.]/g, "");
  return /^[+]?[0-9]+$/.test(trimmed) ? trimmed : undefined;
}

export function normalizeEmail(raw?: string): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed) ? trimmed : undefined;
}
