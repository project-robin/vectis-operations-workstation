import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const BROWSER_BUNDLE_FORBIDDEN_NAMES = [
  "CLERK_SECRET_KEY",
  "CLERK_WEBHOOK_SIGNING_SECRET",
  "DOGRAH_API_KEY",
  "DOGRAH_WEBHOOK_SECRET",
  "TWENTY_MCP_API_KEY",
  "HERMES_MANAGER_KEY",
];

// These values are intentionally synthetic and may be used by CI/build tests.
// A match proves a server-only value crossed the browser boundary even if its
// environment variable name was stripped or transformed by the bundler.
export const BROWSER_BUNDLE_FORBIDDEN_VALUES = [
  "task3-secret-sentinel",
  "task3-webhook-secret-sentinel",
  "task3-dograh-secret-sentinel",
  "task3-twenty-secret-sentinel",
  "task3-hermes-secret-sentinel",
];

function filesUnder(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  });
}

function containsForbiddenName(contents, name) {
  return [
    `process.env.${name}`,
    `process.env?.${name}`,
    `import.meta.env.${name}`,
    `import.meta.env?.${name}`,
    `process.env["${name}"]`,
    `process.env['${name}']`,
    `import.meta.env["${name}"]`,
    `import.meta.env['${name}']`,
  ].some((reference) => contents.includes(reference));
}

export function scanBrowserBundle(
  directory = ".next/static",
  forbidden = [...BROWSER_BUNDLE_FORBIDDEN_NAMES, ...BROWSER_BUNDLE_FORBIDDEN_VALUES],
) {
  if (!existsSync(directory))
    throw new Error(`Browser bundle directory does not exist: ${directory}`);
  const matches = [];
  const files = filesUnder(directory);
  for (const path of files) {
    const contents = readFileSync(path, "utf8");
    for (const needle of forbidden) {
      const found = BROWSER_BUNDLE_FORBIDDEN_NAMES.includes(needle)
        ? containsForbiddenName(contents, needle)
        : contents.includes(needle);
      if (found) matches.push({ path, needle });
    }
  }
  return { filesScanned: files.length, matches };
}

export function main(directory = process.env.NEXT_BROWSER_BUNDLE_DIR ?? ".next/static") {
  const report = scanBrowserBundle(directory);
  if (report.matches.length > 0) {
    for (const match of report.matches) {
      console.error(
        `Browser bundle contains forbidden server-only value ${match.needle}: ${match.path}`,
      );
    }
    return 1;
  }
  console.log(`Browser bundle scan passed: ${report.filesScanned} emitted static files scanned.`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = main(process.argv[2]);
  } catch (error) {
    console.error(`Browser bundle scan failed: ${error.message}`);
    process.exitCode = 1;
  }
}
