import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runCommand, sanitizeEnvironment } from "./verification-helpers.mjs";

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const commands = [
  ["run", "format-check"],
  ["run", "lint"],
  ["run", "check-generated-structure"],
  ["run", "stack-check"],
  ["run", "typecheck"],
  ["test"],
  ["run", "build"],
  ["run", "check-browser-bundle"],
  ["run", "test:e2e"],
];

// Clerk middleware refuses to start without a secret key. This fixed fake value
// is set after sanitizing, so a real inherited CLERK_SECRET_KEY never reaches
// synthetic children.
export const SYNTHETIC_CLERK_SECRET_KEY = "sk_test_synthetic_not_a_real_key";

export function createSyntheticEnvironment(homeDirectory, source = process.env) {
  return {
    ...sanitizeEnvironment(source, {
      HOME: homeDirectory,
      NODE_ENV: "test",
      NEXT_PUBLIC_CONVEX_URL: "https://task2-synthetic.invalid",
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_Y2xlcmsuZXhhbXBsZS5jb20k",
      PLAYWRIGHT_EXECUTABLE_PATH: source.PLAYWRIGHT_EXECUTABLE_PATH,
    }),
    CLERK_SECRET_KEY: SYNTHETIC_CLERK_SECRET_KEY,
  };
}

export function main() {
  const temporaryHome = mkdtempSync(join(tmpdir(), "task2-synthetic-home-"));
  const syntheticEnv = createSyntheticEnvironment(temporaryHome);
  try {
    for (const args of commands) {
      console.log(`\n$ npm ${args.join(" ")}`);
      const status = runCommand(npm, args, { stdio: "inherit", env: syntheticEnv });
      if (status !== 0) return status;
    }

    console.log(
      "\nverify: synthetic deterministic lane passed; it does not run official Convex codegen or real Clerk/Convex integration.",
    );
    return 0;
  } finally {
    rmSync(temporaryHome, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
