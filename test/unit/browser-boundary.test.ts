import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const forbiddenBrowserSecrets = [
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "DOGRAH_API_KEY",
  "DOGRAH_WEBHOOK_SECRET",
  "TWENTY_MCP_API_KEY",
  "HERMES_MANAGER_KEY",
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx|js|jsx)$/.test(path) ? [path] : [];
  });
}

test("browser source never references provider or server-only secrets", () => {
  const browserSource = sourceFiles(join(process.cwd(), "app"))
    .concat(sourceFiles(join(process.cwd(), "components")))
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  for (const secret of forbiddenBrowserSecrets) expect(browserSource).not.toContain(secret);
  expect(browserSource).toContain("ConvexProviderWithClerk");
});
