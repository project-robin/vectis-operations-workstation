import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

const tsxForVitest = {
  name: "tsx-for-vitest",
  enforce: "pre" as const,
  async transform(code: string, id: string) {
    if (id.endsWith(".tsx")) {
      return transformWithEsbuild(code, id, { loader: "tsx", jsx: "automatic" });
    }
    return undefined;
  },
};

export default defineConfig({
  plugins: [tsxForVitest],
  resolve: {
    alias: { "@": root },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "convex",
          environment: "node",
          include: ["convex/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["test/unit/**/*.test.ts", "test/contract/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "components",
          environment: "jsdom",
          include: ["test/components/**/*.test.ts"],
        },
      },
    ],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
