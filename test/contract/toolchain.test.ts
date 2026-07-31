import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { healthResponseSchema } from "../../src/shared/contracts/health.js";

const openApps: Array<ReturnType<typeof buildApp>> = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("TypeScript 7 toolchain contract", () => {
  it("serves a response that matches the shared health schema", async () => {
    const app = buildApp();
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/health/live" });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json())).toEqual({ status: "healthy" });
  });
});
