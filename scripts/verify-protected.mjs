import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parsePort, runCommand, sanitizeEnvironment } from "./verification-helpers.mjs";

const required = [
  "TASK2_PROTECTED_HTTP_URL",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CONVEX_DEPLOYMENT",
  "CONVEX_DEPLOY_KEY",
];
const protectedSignals = [
  ...required,
  "TASK2_PROTECTED_STORAGE_STATE",
  "TASK2_PROTECTED_STORAGE_STATE_JSON",
];
const task3Required = [
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
];
const task3Signals = task3Required;
const OFFICIAL_DEPLOYMENT_METADATA_URL = "https://api.convex.dev/api/deployment/url_for_key";

function rejectUrlAuthority(rawUrl, variableName) {
  const authority = rawUrl.slice("https://".length).split(/[/?#]/, 1)[0];
  if (authority.includes("@")) {
    throw new Error(`${variableName} must not contain URL credentials`);
  }
  if (authority.includes(":")) {
    throw new Error(`${variableName} must not contain a port`);
  }
}

function parseConvexCloudUrl(rawUrl, variableName = "NEXT_PUBLIC_CONVEX_URL") {
  if (typeof rawUrl !== "string") {
    throw new Error(`${variableName} must be a valid HTTPS Convex cloud URL`);
  }
  rejectUrlAuthority(rawUrl, variableName);
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`${variableName} must be a valid HTTPS Convex cloud URL`);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname.endsWith(".convex.cloud") ||
    parsed.hostname === ".convex.cloud"
  ) {
    throw new Error(`${variableName} must be a valid HTTPS Convex cloud URL`);
  }
  return parsed;
}

export function deriveConvexSiteUrl(convexCloudUrl) {
  const parsed = parseConvexCloudUrl(convexCloudUrl);
  return `https://${parsed.hostname.slice(0, -".convex.cloud".length)}.convex.site`;
}

export function parseOfficialDeployKeyIdentity(deployKey) {
  if (typeof deployKey !== "string") return null;
  const separator = deployKey.indexOf("|");
  if (separator <= 0 || separator === deployKey.length - 1) return null;
  const prefix = deployKey.slice(0, separator);
  const match = /^(dev|preview|prod):([a-z0-9-]+)$/.exec(prefix);
  return match ? { type: match[1], deploymentName: match[2] } : null;
}

function validateDeploymentBinding(env) {
  const deploymentMatch = /^(dev|preview|prod):([a-z0-9-]+)$/.exec(env.CONVEX_DEPLOYMENT);
  const keyIdentity = parseOfficialDeployKeyIdentity(env.CONVEX_DEPLOY_KEY);
  if (!deploymentMatch || !keyIdentity) {
    return "verify:protected configuration invalid: CONVEX_DEPLOY_KEY must be an official deployment key";
  }
  if (
    deploymentMatch[1] !== keyIdentity.type ||
    deploymentMatch[2] !== keyIdentity.deploymentName
  ) {
    return "verify:protected configuration invalid: CONVEX_DEPLOY_KEY identity does not match CONVEX_DEPLOYMENT";
  }
  const cloudHost = parseConvexCloudUrl(env.NEXT_PUBLIC_CONVEX_URL).hostname;
  if (cloudHost !== `${keyIdentity.deploymentName}.convex.cloud`) {
    return "verify:protected configuration invalid: CONVEX_DEPLOY_KEY identity does not match NEXT_PUBLIC_CONVEX_URL";
  }
  return null;
}

export function validateConfiguration(env = process.env) {
  const missing = required.filter((name) => !env[name]);
  const storageConfigured =
    Boolean(env.TASK2_PROTECTED_STORAGE_STATE) || Boolean(env.TASK2_PROTECTED_STORAGE_STATE_JSON);
  if (!storageConfigured) {
    missing.push("TASK2_PROTECTED_STORAGE_STATE or TASK2_PROTECTED_STORAGE_STATE_JSON");
  }
  if (missing.length > 0) {
    return { error: `verify:protected is enabled but missing: ${missing.join(", ")}` };
  }

  let derivedHttpUrl;
  try {
    derivedHttpUrl = deriveConvexSiteUrl(env.NEXT_PUBLIC_CONVEX_URL);
    const protectedHttp = new URL(env.TASK2_PROTECTED_HTTP_URL);
    rejectUrlAuthority(env.TASK2_PROTECTED_HTTP_URL, "TASK2_PROTECTED_HTTP_URL");
    if (
      protectedHttp.protocol !== "https:" ||
      protectedHttp.pathname !== "/" ||
      protectedHttp.search ||
      protectedHttp.hash ||
      !protectedHttp.hostname.endsWith(".convex.site") ||
      protectedHttp.hostname === ".convex.site"
    ) {
      throw new Error("TASK2_PROTECTED_HTTP_URL must be a valid HTTPS Convex site URL");
    }
  } catch (error) {
    return { error: `verify:protected configuration invalid: ${error.message}` };
  }

  const bindingError = validateDeploymentBinding(env);
  if (bindingError) return { error: bindingError };
  if (env.TASK2_PROTECTED_HTTP_URL !== derivedHttpUrl) {
    return {
      error:
        "verify:protected configuration invalid: TASK2_PROTECTED_HTTP_URL must match the Convex site URL derived from NEXT_PUBLIC_CONVEX_URL",
    };
  }
  return { derivedHttpUrl };
}

export function validateTask3Configuration(env = process.env) {
  const configured = task3Signals.some((name) => Boolean(env[name]));
  if (!configured) return { configured: false };
  const missing = task3Required.filter((name) => !env[name]);
  if (missing.length > 0) {
    return {
      configured: false,
      error: `verify:protected Task 3 configuration is partial; missing: ${missing.join(", ")}`,
    };
  }
  if (env.TASK3_PROTECTED_DISPOSABLE_TENANT !== "1") {
    return {
      configured: false,
      error: "verify:protected Task 3 requires TASK3_PROTECTED_DISPOSABLE_TENANT=1",
    };
  }
  const expectedRoles = {
    TASK3_PROTECTED_OWNER_ROLE: "owner",
    TASK3_PROTECTED_OPERATOR_ROLE: "operator",
    TASK3_PROTECTED_STAFF_ROLE: "staff",
  };
  const invalidRoleLabels = Object.entries(expectedRoles)
    .filter(([name, expected]) => env[name] !== expected)
    .map(([name]) => name);
  if (invalidRoleLabels.length > 0) {
    return {
      configured: false,
      error:
        "verify:protected Task 3 role labels must match the owner/operator/staff fixture policy",
    };
  }
  return { configured: true };
}

export async function validateOfficialDeploymentIdentity({
  deployKey,
  expectedConvexUrl,
  fetchImpl = fetch,
}) {
  if (!parseOfficialDeployKeyIdentity(deployKey)) {
    throw new Error("official Convex deployment metadata requires an official CONVEX_DEPLOY_KEY");
  }
  const response = await fetchImpl(OFFICIAL_DEPLOYMENT_METADATA_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${deployKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ deployKey }),
  });
  if (!response.ok) {
    throw new Error("official Convex deployment metadata could not validate CONVEX_DEPLOY_KEY");
  }
  const metadata = await response.json();
  const officialUrl =
    typeof metadata === "string"
      ? metadata
      : metadata && typeof metadata.url === "string"
        ? metadata.url
        : metadata && typeof metadata.deploymentUrl === "string"
          ? metadata.deploymentUrl
          : null;
  if (!officialUrl) {
    throw new Error("official Convex deployment metadata did not include a deployment URL");
  }
  const expected = parseConvexCloudUrl(expectedConvexUrl);
  const actual = parseConvexCloudUrl(officialUrl, "official Convex deployment metadata URL");
  if (actual.origin !== expected.origin) {
    throw new Error(
      "verify:protected configuration invalid: official CONVEX_DEPLOY_KEY metadata does not match NEXT_PUBLIC_CONVEX_URL",
    );
  }
  return { convexUrl: actual.origin, httpUrl: deriveConvexSiteUrl(actual.origin) };
}

export function protectedEnvironment(storageState, port, httpUrl, source = process.env) {
  return sanitizeEnvironment(source, {
    CONVEX_DEPLOY_KEY: source.CONVEX_DEPLOY_KEY,
    CONVEX_DEPLOYMENT: source.CONVEX_DEPLOYMENT,
    NEXT_PUBLIC_CONVEX_URL: source.NEXT_PUBLIC_CONVEX_URL,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: source.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
    PLAYWRIGHT_PORT: String(port),
    TASK2_PROTECTED: "1",
    TASK2_PROTECTED_HTTP_URL: httpUrl,
    TASK2_PROTECTED_PORT: String(port),
    TASK2_PROTECTED_STORAGE_STATE: storageState,
    TASK3_PROTECTED_DISPOSABLE_TENANT: source.TASK3_PROTECTED_DISPOSABLE_TENANT,
    TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID: source.TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID,
    TASK3_PROTECTED_CROSS_TENANT_ORGANIZATION_ID:
      source.TASK3_PROTECTED_CROSS_TENANT_ORGANIZATION_ID,
    TASK3_PROTECTED_OWNER_CLERK_ID: source.TASK3_PROTECTED_OWNER_CLERK_ID,
    TASK3_PROTECTED_OPERATOR_CLERK_ID: source.TASK3_PROTECTED_OPERATOR_CLERK_ID,
    TASK3_PROTECTED_STAFF_CLERK_ID: source.TASK3_PROTECTED_STAFF_CLERK_ID,
    TASK3_PROTECTED_OWNER_ROLE: source.TASK3_PROTECTED_OWNER_ROLE,
    TASK3_PROTECTED_OPERATOR_ROLE: source.TASK3_PROTECTED_OPERATOR_ROLE,
    TASK3_PROTECTED_STAFF_ROLE: source.TASK3_PROTECTED_STAFF_ROLE,
    TASK3_PROTECTED_OWNER_STORAGE_STATE: source.TASK3_PROTECTED_OWNER_STORAGE_STATE,
    TASK3_PROTECTED_OPERATOR_STORAGE_STATE: source.TASK3_PROTECTED_OPERATOR_STORAGE_STATE,
    TASK3_PROTECTED_STAFF_STORAGE_STATE: source.TASK3_PROTECTED_STAFF_STORAGE_STATE,
    TASK3_PROTECTED_CROSS_TENANT_STORAGE_STATE: source.TASK3_PROTECTED_CROSS_TENANT_STORAGE_STATE,
  });
}

function startServer(npm, port, env) {
  return spawn(npm, ["run", "start", "--", "--hostname", "127.0.0.1", "--port", String(port)], {
    stdio: "inherit",
    env,
  });
}

async function waitForServer(server, url) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`protected Next.js server exited with status ${server.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // The server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`protected Next.js server did not become ready at ${url}`);
}

export async function main() {
  const configured = protectedSignals.some((name) => Boolean(process.env[name]));
  if (!configured) {
    if (process.env.TASK2_ALLOW_LOCAL_PROTECTED_SKIP === "1") {
      console.log(
        "verify:protected skipped: protected configuration is absent; local skip mode was explicitly enabled.",
      );
      return 0;
    }
    console.error(
      "verify:protected is not configured. Set TASK2_ALLOW_LOCAL_PROTECTED_SKIP=1 only for an explicit local skip; CI preflight skips this job when no protected secrets exist.",
    );
    return 1;
  }

  const configuration = validateConfiguration();
  if (configuration.error) {
    console.error(configuration.error);
    return 1;
  }
  const task3Configuration = validateTask3Configuration();
  if (task3Configuration.error) {
    console.error(task3Configuration.error);
    return 1;
  }

  let temporaryDirectory;
  let server;
  try {
    await validateOfficialDeploymentIdentity({
      deployKey: process.env.CONVEX_DEPLOY_KEY,
      expectedConvexUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    });
    let storageState = process.env.TASK2_PROTECTED_STORAGE_STATE;
    if (!storageState) {
      temporaryDirectory = mkdtempSync(join(tmpdir(), "task2-clerk-"));
      storageState = join(temporaryDirectory, "storage-state.json");
      writeFileSync(storageState, process.env.TASK2_PROTECTED_STORAGE_STATE_JSON, { mode: 0o600 });
    }
    if (!existsSync(storageState)) {
      console.error("verify:protected storage state file does not exist");
      return 1;
    }

    const port = parsePort(process.env.TASK2_PROTECTED_PORT, 3200);
    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    const env = protectedEnvironment(storageState, port, configuration.derivedHttpUrl);
    const commands = [
      ["run", "codegen:protected"],
      ["run", "check-generated-structure"],
      ["run", "typecheck"],
      ["run", "build"],
    ];
    for (const args of commands) {
      console.log(`\n$ npm ${args.join(" ")}`);
      const status = runCommand(npm, args, { stdio: "inherit", env });
      if (status !== 0) return status;
    }

    server = startServer(npm, port, env);
    await waitForServer(server, `http://127.0.0.1:${port}/`);
    const playwrightArgs = [
      "exec",
      "playwright",
      "test",
      "--config=playwright.protected.config.ts",
    ];
    console.log(`\n$ npm ${playwrightArgs.join(" ")}`);
    const status = runCommand(npm, playwrightArgs, { stdio: "inherit", env });
    if (status !== 0) return status;

    if (task3Configuration.configured) {
      console.log(
        "verify:protected passed official Convex identity validation, codegen, generated checks, protected build, and Task 2/3 local-app Clerk/Convex integration.",
      );
    } else {
      console.log(
        "verify:protected passed the Task 2 protected lane; Task 3 live tenant-boundary verification is blocked because no disposable fixture was configured.",
      );
    }
    return 0;
  } catch (error) {
    console.error(`verify:protected failed: ${error.message}`);
    return 1;
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
