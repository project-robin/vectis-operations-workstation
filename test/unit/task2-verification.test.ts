import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import {
  parsePort,
  runCommand,
  sanitizeEnvironment,
} from "../../scripts/verification-helpers.mjs";
import {
  deriveConvexSiteUrl,
  protectedEnvironment,
  validateTask3Configuration,
  validateOfficialDeploymentIdentity,
} from "../../scripts/verify-protected.mjs";
import { validateGeneratedStructure } from "../../scripts/check-generated-structure.mjs";
import {
  createSyntheticEnvironment,
  SYNTHETIC_CLERK_SECRET_KEY,
} from "../../scripts/verify-synthetic.mjs";

const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const playwrightConfig = readFileSync(
  new URL("../../playwright.config.ts", import.meta.url),
  "utf8",
);
const protectedVerifier = readFileSync(
  new URL("../../scripts/verify-protected.mjs", import.meta.url),
  "utf8",
);
const syntheticVerifier = readFileSync(
  new URL("../../scripts/verify-synthetic.mjs", import.meta.url),
  "utf8",
);
const stackCheck = readFileSync(new URL("../../scripts/stack-check.mjs", import.meta.url), "utf8");
const ciWorkflow = readFileSync(new URL("../../.github/workflows/ci.yml", import.meta.url), "utf8");

test("codegen script names distinguish checking from official generation", () => {
  expect(packageJson.scripts.codegen).toBeUndefined();
  expect(packageJson.scripts["check-generated-structure"]).toBe(
    "node scripts/check-generated-structure.mjs",
  );
  expect(packageJson.scripts["codegen:protected"]).toBe("node scripts/codegen-protected.mjs");
  expect(protectedVerifier).toContain('["run", "codegen:protected"]');
});

test("browser verification uses an installed or explicitly supplied executable only", () => {
  expect(playwrightConfig).not.toContain(".cache/ms-playwright");
  expect(playwrightConfig).toContain('"/usr/bin/google-chrome"');
  expect(playwrightConfig).toContain("PLAYWRIGHT_EXECUTABLE_PATH");
  expect(protectedVerifier).toContain("PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH");
  expect(syntheticVerifier).toContain("PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH");
});

test("stack checking covers scripts and config while allowing test tooling", () => {
  expect(stackCheck).toContain('"scripts"');
  expect(stackCheck).toContain("config.ts");
  expect(stackCheck).toContain("vitest");
  expect(stackCheck).toContain("playwright");
});

test("synthetic children receive an allowlisted environment, not inherited secrets", () => {
  const env = sanitizeEnvironment(
    {
      PATH: "/bin",
      HOME: "/tmp",
      NODE_ENV: "test",
      CLERK_SECRET_KEY: "clerk-secret",
      CONVEX_DEPLOYMENT: "prod:secret-deployment",
      DOGRAH_API_KEY: "dograh-secret",
      HERMES_MANAGER_KEY: "hermes-secret",
      TWENTY_MCP_API_KEY: "twenty-secret",
      TASK2_PROTECTED_STORAGE_STATE_JSON: "protected-session",
    },
    {
      NEXT_PUBLIC_CONVEX_URL: "https://task2-synthetic.invalid",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
    },
  );
  expect(env).toEqual({
    PATH: "/bin",
    HOME: "/tmp",
    NODE_ENV: "test",
    NEXT_PUBLIC_CONVEX_URL: "https://task2-synthetic.invalid",
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
  });
  expect(env).not.toHaveProperty("CLERK_SECRET_KEY");
  expect(env).not.toHaveProperty("CONVEX_DEPLOYMENT");
  expect(env).not.toHaveProperty("TASK2_PROTECTED_STORAGE_STATE_JSON");
});

test("protected children receive the deploy key and browser executable, while synthetic children do not", () => {
  const source: NodeJS.ProcessEnv = {
    PATH: "/bin",
    HOME: "/home/user",
    NODE_ENV: "test",
    CONVEX_DEPLOY_KEY: "prod:deployment|secret",
    PLAYWRIGHT_EXECUTABLE_PATH: "/usr/bin/chromium",
  };
  const protectedEnv = sanitizeEnvironment(source, {
    CONVEX_DEPLOY_KEY: source.CONVEX_DEPLOY_KEY,
    PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  const syntheticEnv = sanitizeEnvironment(source, {
    PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  expect(protectedEnv).toMatchObject({
    CONVEX_DEPLOY_KEY: source.CONVEX_DEPLOY_KEY,
    PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
  });
  expect(syntheticEnv).not.toHaveProperty("CONVEX_DEPLOY_KEY");
  expect(syntheticEnv).toHaveProperty("PLAYWRIGHT_EXECUTABLE_PATH", source.PLAYWRIGHT_EXECUTABLE_PATH);
  expect(protectedEnvironment("/tmp/storage-state.json", 3200, "https://deployment.convex.site", source)).toMatchObject({
    CONVEX_DEPLOY_KEY: source.CONVEX_DEPLOY_KEY,
    PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
  });
});

test("synthetic children use an empty temporary HOME", () => {
  const env = createSyntheticEnvironment("/tmp/task2-empty-home", {
    PATH: "/bin",
    HOME: "/home/real-user",
    NODE_ENV: "test",
  });
  expect(env).toHaveProperty("HOME", "/tmp/task2-empty-home");
});

test("synthetic children get a fixed fake Clerk secret, never the inherited one", () => {
  const env = createSyntheticEnvironment("/tmp/task2-empty-home", {
    PATH: "/bin",
    HOME: "/home/real-user",
    NODE_ENV: "test",
    CLERK_SECRET_KEY: "sk_live_real_secret",
  });
  expect(env.CLERK_SECRET_KEY).toBe(SYNTHETIC_CLERK_SECRET_KEY);
  expect(Object.values(env)).not.toContain("sk_live_real_secret");
});

test("Playwright port parsing rejects shell and out-of-range values", () => {
  expect(parsePort(undefined)).toBe(3100);
  expect(parsePort("1")).toBe(1);
  expect(parsePort("65535")).toBe(65535);
  for (const hostile of ["0", "65536", "3100;touch /tmp/pwned", "3100 && whoami", "1.5", "", " 3100"]) {
    expect(() => parsePort(hostile)).toThrow(/decimal integer.*1 to 65535/i);
  }
});

test("Convex cloud URLs reject credentials and explicit ports", () => {
  expect(deriveConvexSiteUrl("https://deployment.convex.cloud")).toBe(
    "https://deployment.convex.site",
  );
  for (const hostile of [
    "https://user:password@deployment.convex.cloud",
    "https://deployment.convex.cloud:443",
    "https://deployment.convex.cloud:8443",
  ]) {
    expect(() => deriveConvexSiteUrl(hostile)).toThrow(/credentials|port/i);
  }
});

test("verification command failures propagate their exact exit status", () => {
  expect(
    runCommand(process.execPath, ["-e", "process.exit(7)"], {
      env: sanitizeEnvironment({ PATH: process.env.PATH, NODE_ENV: "test" }, { NODE_ENV: "test" }),
      stdio: "ignore",
    }),
  ).toBe(7);
});

test("official deployment validation sends the deploy key as a bearer credential", async () => {
  const deployKey = "prod:deployment|secret";
  let request: Request | undefined;
  const result = await validateOfficialDeploymentIdentity({
    deployKey,
    expectedConvexUrl: "https://deployment.convex.cloud",
    fetchImpl: async (_url, init) => {
      request = new Request(String(_url), init);
      return new Response(JSON.stringify({ url: "https://deployment.convex.cloud" }), { status: 200 });
    },
  });
  expect(request?.headers.get("authorization")).toBe(`Bearer ${deployKey}`);
  expect(result).toEqual({
    convexUrl: "https://deployment.convex.cloud",
    httpUrl: "https://deployment.convex.site",
  });
});

test("protected verification requires an explicit local skip mode", () => {
  const output = execFileSync(process.execPath, ["scripts/verify-protected.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: { PATH: process.env.PATH ?? "", NODE_ENV: "test", TASK2_ALLOW_LOCAL_PROTECTED_SKIP: "1" },
    encoding: "utf8",
  });
  expect(output).toContain("verify:protected skipped:");
});

test("protected verification fails partial config without printing secret values", () => {
  const secret = "protected-session-secret-value";
  const result = spawnSync(process.execPath, ["scripts/verify-protected.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CONVEX_DEPLOYMENT: "prod:deployment",
      TASK2_PROTECTED_STORAGE_STATE_JSON: secret,
    },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("TASK2_PROTECTED_HTTP_URL");
  expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
});

test("protected verification requires CONVEX_DEPLOY_KEY in partial configuration", () => {
  const secret = "protected-session-secret-value";
  const result = spawnSync(process.execPath, ["scripts/verify-protected.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CONVEX_DEPLOYMENT: "prod:deployment",
      TASK2_PROTECTED_HTTP_URL: "https://deployment.convex.site",
      TASK2_PROTECTED_STORAGE_STATE_JSON: secret,
    },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("CONVEX_DEPLOY_KEY");
  expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
});

test("Task 3 protected verification is explicitly blocked when its disposable fixture is absent", () => {
  expect(validateTask3Configuration({} as NodeJS.ProcessEnv)).toEqual({ configured: false });
});

test("Task 3 protected verification rejects partial or non-disposable fixture configuration", () => {
  expect(validateTask3Configuration({ NODE_ENV: "test", TASK3_PROTECTED_DISPOSABLE_TENANT: "1" })).toMatchObject({
    configured: false,
    error: expect.stringContaining("partial"),
  });
  const complete: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    TASK3_PROTECTED_DISPOSABLE_TENANT: "0",
    ...Object.fromEntries(
      [
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
      ].map((key) => [key, "fixture"]),
    ),
  };
  expect(validateTask3Configuration(complete)).toMatchObject({
    configured: false,
    error: expect.stringContaining("DISPOSABLE_TENANT=1"),
  });
  expect(
    validateTask3Configuration({
      ...complete,
      TASK3_PROTECTED_DISPOSABLE_TENANT: "1",
      TASK3_PROTECTED_OWNER_ROLE: "operator",
      TASK3_PROTECTED_OPERATOR_ROLE: "owner",
      TASK3_PROTECTED_STAFF_ROLE: "staff",
    }),
  ).toMatchObject({
    configured: false,
    error: expect.stringContaining("role labels"),
  });
});

test("protected child environment carries explicit Task 3 fixture values", () => {
  const source: NodeJS.ProcessEnv = {
    NODE_ENV: "test",
    TASK3_PROTECTED_DISPOSABLE_TENANT: "1",
    TASK3_PROTECTED_FIXTURE_ORGANIZATION_ID: "org_fixture",
    TASK3_PROTECTED_OWNER_ROLE: "owner",
  };
  expect(
    protectedEnvironment("/tmp/storage-state.json", 3200, "https://deployment.convex.site", source),
  ).toMatchObject(source);
});

test("protected verification rejects a Convex URL from a different deployment", () => {
  const result = spawnSync(process.execPath, ["scripts/verify-protected.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CONVEX_DEPLOYMENT: "prod:other-deployment",
      CONVEX_DEPLOY_KEY: "prod:other-deployment|protected-secret",
      TASK2_PROTECTED_HTTP_URL: "https://deployment.convex.site",
      TASK2_PROTECTED_STORAGE_STATE_JSON: "protected-session-secret",
    },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("does not match NEXT_PUBLIC_CONVEX_URL");
});

test("protected verification rejects a deploy key whose official identity differs from the URL", () => {
  const key = "prod:other-deployment|protected-secret";
  const result = spawnSync(process.execPath, ["scripts/verify-protected.mjs"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      PATH: process.env.PATH ?? "",
      NODE_ENV: "test",
      NEXT_PUBLIC_CONVEX_URL: "https://deployment.convex.cloud",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_public",
      CONVEX_DEPLOYMENT: "prod:deployment",
      CONVEX_DEPLOY_KEY: key,
      TASK2_PROTECTED_HTTP_URL: "https://deployment.convex.site",
      TASK2_PROTECTED_STORAGE_STATE_JSON: "protected-session",
    },
    encoding: "utf8",
  });
  expect(result.status).toBe(1);
  expect(`${result.stdout}${result.stderr}`).toContain("CONVEX_DEPLOY_KEY identity");
  expect(`${result.stdout}${result.stderr}`).not.toContain(key);
});

test("official deployment metadata mismatch fails without exposing the deploy key", async () => {
  const key = "prod:deployment|protected-secret";
  await expect(
    validateOfficialDeploymentIdentity({
      deployKey: key,
      expectedConvexUrl: "https://deployment.convex.cloud",
      fetchImpl: async () =>
        new Response(JSON.stringify({ url: "https://other.convex.cloud" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    }),
  ).rejects.toThrow(/does not match NEXT_PUBLIC_CONVEX_URL/);
});

test("generated structure accepts official anyApi but rejects unmarked stubs", () => {
  const directory = mkdtempSync(join(tmpdir(), "task2-generated-"));
  const header = `/* eslint-disable */\n/**\n * THIS CODE IS AUTOMATICALLY GENERATED.\n * @module\n */\n`;
  try {
    writeFileSync(join(directory, "api.js"), `${header}import { anyApi } from "convex/server";\nexport const api = anyApi;\nexport const internal = anyApi;\n`);
    writeFileSync(join(directory, "api.d.ts"), `${header}export declare const api: unknown;\nexport declare const internal: unknown;\n`);
    writeFileSync(join(directory, "server.js"), `${header}export const query = queryGeneric;\nexport const mutation = mutationGeneric;\n`);
    writeFileSync(join(directory, "server.d.ts"), `${header}export declare const query: unknown;\nexport declare const mutation: unknown;\n`);
    expect(validateGeneratedStructure(directory)).toEqual({ status: "valid" });

    writeFileSync(join(directory, "api.js"), `/* Local test-only placeholder */\nexport const api = anyApi;\n`);
    expect(validateGeneratedStructure(directory)).toEqual({ status: "skipped" });

    writeFileSync(join(directory, "api.js"), "export const api = anyApi;\n");
    expect(validateGeneratedStructure(directory).status).toBe("invalid");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protected verification orders codegen, structure, typecheck, and build before browser tests", () => {
  const order = [
    '"run", "codegen:protected"',
    '"run", "check-generated-structure"',
    '"run", "typecheck"',
    '"run", "build"',
    '"exec",\n      "playwright"',
  ].map((needle) => protectedVerifier.indexOf(needle));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("protected verification uses a temporary directory for inline storage state", () => {
  expect(protectedVerifier).toContain("mkdtempSync");
  expect(protectedVerifier).toContain("rmSync");
});

test("CI exposes a genuinely skipped protected job from a non-secret preflight output", () => {
  expect(ciWorkflow).toContain("protected-preflight:");
  expect(ciWorkflow).toContain("configured: ${{ steps.detect.outputs.configured }}");
  expect(ciWorkflow).toContain("needs: [verify, protected-preflight]");
  expect(ciWorkflow).toContain("needs.protected-preflight.outputs.configured == 'true'");
  expect(ciWorkflow).toContain("GITHUB_OUTPUT");
});
