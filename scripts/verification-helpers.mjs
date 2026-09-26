import { spawnSync } from "node:child_process";

const INHERITED_SAFE_KEYS = [
  "CI",
  "HOME",
  "LOGNAME",
  "NODE_ENV",
  "PATH",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USER",
  "WINDIR",
];

const EXPLICIT_SAFE_KEYS = new Set([
  "CONVEX_DEPLOY_KEY",
  "CONVEX_DEPLOYMENT",
  "HOME",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_CONVEX_URL",
  "PLAYWRIGHT_EXECUTABLE_PATH",
  "PLAYWRIGHT_PORT",
  "TASK2_PROTECTED",
  "TASK2_PROTECTED_HTTP_URL",
  "TASK2_PROTECTED_PORT",
  "TASK2_PROTECTED_STORAGE_STATE",
  "TASK3_PROTECTED_DISPOSABLE_TENANT",
  "TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID",
  "TASK3_PROTECTED_CROSS_TENANT_ORGANIZATION_ID",
  "TASK3_PROTECTED_OWNER_CLERK_ID",
  "TASK3_PROTECTED_OPERATOR_CLERK_ID",
  "TASK3_PROTECTED_STAFF_CLERK_ID",
  "TASK3_PROTECTED_OWNER_ROLE",
  "TASK3_PROTECTED_OPERATOR_ROLE",
  "TASK3_PROTECTED_STAFF_ROLE",
  "TASK3_PROTECTED_OWNER_STORAGE_STATE",
  "TASK3_PROTECTED_OPERATOR_STORAGE_STATE",
  "TASK3_PROTECTED_STAFF_STORAGE_STATE",
  "TASK3_PROTECTED_CROSS_TENANT_STORAGE_STATE",
]);

export function sanitizeEnvironment(source = process.env, overrides = {}) {
  const env = {};
  for (const name of INHERITED_SAFE_KEYS) {
    if (source[name] !== undefined) env[name] = source[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (value !== undefined && EXPLICIT_SAFE_KEYS.has(name)) env[name] = value;
  }
  return env;
}

export function parsePort(rawValue, fallback = 3100) {
  const raw = rawValue ?? String(fallback);
  if (!/^[1-9]\d{0,4}$/.test(raw)) {
    throw new Error("PLAYWRIGHT_PORT must be a decimal integer from 1 to 65535");
  }
  const port = Number(raw);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error("PLAYWRIGHT_PORT must be a decimal integer from 1 to 65535");
  }
  return port;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    console.error(`${command} failed to start: ${result.error.message}`);
    return 1;
  }
  return result.status ?? 1;
}
