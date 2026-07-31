import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/server/db/schema/*.ts",
  out: "./db/migrations",
  dialect: "postgresql",
});
