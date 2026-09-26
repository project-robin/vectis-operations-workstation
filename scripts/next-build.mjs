import { spawnSync } from "node:child_process";

const required = ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length > 0) {
  console.error(
    `next build requires explicit deployment configuration: ${missing.join(", ")}. ` +
      "Set these values in the invoking deployment or verification command; build tooling does not provide fallbacks.",
  );
  process.exit(1);
}

const result = spawnSync("next", ["build"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(result.status ?? 1);
