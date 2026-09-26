import { defineConfig } from "@playwright/test";
import baseConfig from "./playwright.config";
import { parsePort } from "./scripts/verification-helpers.mjs";

const port = parsePort(process.env.TASK2_PROTECTED_PORT, 3200);

export default defineConfig({
  ...baseConfig,
  testDir: "./test/protected",
  use: {
    ...baseConfig.use,
    baseURL: `http://127.0.0.1:${port}`,
    storageState: process.env.TASK2_PROTECTED_STORAGE_STATE,
  },
  webServer: undefined,
});
