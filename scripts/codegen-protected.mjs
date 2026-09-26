import { spawnSync } from "node:child_process";

if (process.env.TASK2_PROTECTED !== "1") {
  console.error(
    "Official Convex codegen is protected. Set TASK2_PROTECTED=1 with CONVEX_DEPLOYMENT in the protected lane; no offline generator is substituted.",
  );
  process.exit(1);
}
if (!process.env.CONVEX_DEPLOYMENT) {
  console.error(
    "Official Convex codegen requires CONVEX_DEPLOYMENT. Configure a real protected deployment; this command will not fabricate generated files.",
  );
  process.exit(1);
}

const result = spawnSync("npx", ["--no-install", "convex", "codegen"], {
  stdio: "inherit",
  env: process.env,
});
process.exit(result.status ?? 1);
