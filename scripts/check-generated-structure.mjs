import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const defaultGeneratedDir = join(root, "convex", "_generated");
const requiredFiles = ["api.js", "api.d.ts", "server.js", "server.d.ts"];
const OFFICIAL_HEADER = /THIS CODE IS AUTOMATICALLY GENERATED\./;
const LOCAL_PLACEHOLDER = /Local test-only placeholder/;

export function validateGeneratedStructure(generatedDir = defaultGeneratedDir) {
  const missing = requiredFiles.filter((file) => !existsSync(join(generatedDir, file)));
  if (missing.length > 0) return { status: "missing", missing };

  const files = Object.fromEntries(
    requiredFiles.map((file) => [file, readFileSync(join(generatedDir, file), "utf8")]),
  );
  if (Object.values(files).some((contents) => LOCAL_PLACEHOLDER.test(contents))) {
    return { status: "skipped" };
  }
  const withoutOfficialHeader = requiredFiles.filter((file) => !OFFICIAL_HEADER.test(files[file]));
  if (withoutOfficialHeader.length > 0) {
    return {
      status: "invalid",
      error: `Convex generated artifacts are missing the official generated header: ${withoutOfficialHeader.join(", ")}`,
    };
  }

  const declarations = [
    ["api.js", /export const api\s*=\s*anyApi\b/, /export const internal\s*=\s*anyApi\b/],
    ["api.d.ts", /export declare const api\b/, /export declare const internal\b/],
    [
      "server.js",
      /export const query\s*=\s*queryGeneric\b/,
      /export const mutation\s*=\s*mutationGeneric\b/,
    ],
    ["server.d.ts", /export declare const query\b/, /export declare const mutation\b/],
  ];
  for (const [file, ...patterns] of declarations) {
    const missingDeclarations = patterns.filter((pattern) => !pattern.test(files[file]));
    if (missingDeclarations.length > 0) {
      return {
        status: "invalid",
        error: `Convex generated ${file} is missing official declarations`,
      };
    }
  }
  return { status: "valid" };
}

export function main(generatedDir = defaultGeneratedDir) {
  const result = validateGeneratedStructure(generatedDir);
  if (result.status === "missing") {
    console.log(
      `generated-structure: skipped; official Convex generated artifacts are not present (${result.missing.join(
        ", ",
      )}). Run the protected official lane with CONVEX_DEPLOYMENT configured; this check never generates or repairs them.`,
    );
    return 0;
  }
  if (result.status === "skipped") {
    console.log(
      "generated-structure: skipped; explicit local-placeholder artifacts are not accepted as official output. Run the protected official lane with CONVEX_DEPLOYMENT configured.",
    );
    return 0;
  }
  if (result.status === "invalid") {
    console.error(result.error);
    return 1;
  }
  console.log(
    `generated-structure: ${requiredFiles.length} Convex artifacts present with official headers and declarations; no freshness or deployment sync is claimed`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main();
}
