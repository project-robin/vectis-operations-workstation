import { describe, expect, it } from "vitest";
import { readServerConfig } from "../../../src/server/config.js";

describe("server configuration", () => {
  it("requires a database URL and applies bounded network defaults", () => {
    expect(() => readServerConfig({})).toThrow("DATABASE_URL");

    expect(
      readServerConfig({ DATABASE_URL: "postgres://vectis:test@127.0.0.1:55432/workstation" }),
    ).toEqual({
      databaseUrl: "postgres://vectis:test@127.0.0.1:55432/workstation",
      host: "127.0.0.1",
      port: 4100,
    });
  });

  it("refuses public binding without an API key", () => {
    expect(() =>
      readServerConfig({
        DATABASE_URL: "postgres://vectis:***@localhost/workstation",
        HOST: "0.0.0.0",
      }),
    ).toThrow("WORKSTATION_API_KEY");

    expect(
      readServerConfig({
        DATABASE_URL: "postgres://vectis:***@localhost/workstation",
        HOST: "0.0.0.0",
        WORKSTATION_API_KEY: "public-test-key",
      }),
    ).toMatchObject({ host: "0.0.0.0", apiKey: "public-test-key" });
  });

  it("rejects invalid ports", () => {
    expect(() =>
      readServerConfig({ DATABASE_URL: "postgres://vectis:test@localhost/workstation", PORT: "0" }),
    ).toThrow();
  });
});
