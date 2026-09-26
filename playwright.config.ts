import { accessSync, constants } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { parsePort } from "./scripts/verification-helpers.mjs";

const required = ["NEXT_PUBLIC_CONVEX_URL", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
const missing = required.filter((name) => !process.env[name]);
if (missing.length > 0) {
  throw new Error(
    `Playwright requires explicit deployment configuration: ${missing.join(", ")}. ` +
      "Set these values in the invoking verification or deployment command; the browser config does not provide fallbacks.",
  );
}

function resolveBrowserExecutable(): string {
  const explicit = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  if (explicit) {
    try {
      accessSync(explicit, constants.X_OK);
      return explicit;
    } catch {
      throw new Error(`PLAYWRIGHT_EXECUTABLE_PATH is not executable: ${explicit}`);
    }
  }

  for (const candidate of [
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ]) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next installed browser.
    }
  }

  throw new Error(
    "No executable Chrome/Chromium was found. Install Chrome/Chromium through the OS image or set PLAYWRIGHT_EXECUTABLE_PATH; this project does not download browser binaries.",
  );
}

const port = parsePort(process.env.PLAYWRIGHT_PORT);
const browserExecutable = resolveBrowserExecutable();

export default defineConfig({
  testDir: "./test/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? "dot" : "list",
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "on-first-retry",
    launchOptions: { executablePath: browserExecutable },
  },
  projects: [{ name: "chromium-installed", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
