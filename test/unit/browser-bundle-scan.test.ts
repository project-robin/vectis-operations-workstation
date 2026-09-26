import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { BROWSER_BUNDLE_FORBIDDEN_VALUES, BROWSER_BUNDLE_FORBIDDEN_NAMES, scanBrowserBundle } from "../../scripts/check-browser-bundle.mjs";

test("browser bundle scan detects server-only names and secret sentinel values in emitted chunks", () => {
  const directory = mkdtempSync(join(tmpdir(), "task3-bundle-scan-"));
  try {
    mkdirSync(join(directory, "chunks"));
    writeFileSync(
      join(directory, "chunks", "safe.js"),
      `console.log("public"); process.env.CLERK_SECRET_KEY="x";`,
    );
    writeFileSync(join(directory, "chunks", "nested.js"), `const value = "${BROWSER_BUNDLE_FORBIDDEN_VALUES[0]}";`);
    const report = scanBrowserBundle(directory);
    expect(report.filesScanned).toBe(2);
    expect(report.matches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ needle: BROWSER_BUNDLE_FORBIDDEN_NAMES[0] }),
        expect.objectContaining({ needle: BROWSER_BUNDLE_FORBIDDEN_VALUES[0] }),
      ]),
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("browser bundle scan passes emitted chunks that contain only public code and values", () => {
  const directory = mkdtempSync(join(tmpdir(), "task3-bundle-safe-"));
  try {
    writeFileSync(join(directory, "app.js"), "self.__PUBLIC_CONFIG__ = { ready: true };\n");
    expect(scanBrowserBundle(directory)).toEqual({ filesScanned: 1, matches: [] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
