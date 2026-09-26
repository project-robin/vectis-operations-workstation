import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const forbiddenPackages = ["fastify", "drizzle-orm", "pg", "vite"];
const directPackages = {
  ...packageJson.dependencies,
  ...packageJson.devDependencies,
};
const directViolations = forbiddenPackages.filter((name) => name in directPackages);
const sourceImportPattern = /(?:from|import)\s*["'][^"']*(fastify|drizzle-orm|pg|vite)(?:["'/]|$)/;
const sourceViolations = [];
const toolingConfigPattern =
  /(?:^|[\\/])(vitest|playwright)(?:\.protected)?\.config\.[cm]?[jt]sx?$/;

function scan(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      scan(path);
    } else {
      scanFile(path);
    }
  }
}

function scanFile(path) {
  if (!/\.(?:js|jsx|ts|tsx)$/.test(path) || toolingConfigPattern.test(path)) return;
  const source = readFileSync(path, "utf8");
  if (sourceImportPattern.test(source)) sourceViolations.push(path);
}

for (const rootName of ["app", "components", "convex", "lib", "scripts"]) {
  const path = join(root, rootName);
  if (existsSync(path)) scan(path);
}

for (const entry of readdirSync(root)) {
  if (entry.endsWith(".config.ts") || entry.endsWith(".config.mjs")) {
    const path = join(root, entry);
    scanFile(path);
  }
}

if (directViolations.length > 0 || sourceViolations.length > 0) {
  console.error("Forbidden retired-stack references detected");
  for (const packageName of directViolations) console.error(`package: ${packageName}`);
  for (const path of sourceViolations) console.error(`source: ${path}`);
  process.exit(1);
}

console.log("stack check: Next.js + Convex + Clerk application surface is clean");
