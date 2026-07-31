import { defineConfig } from "vitest/config";

process.env.NODE_ENV = "test";

export default defineConfig({
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
