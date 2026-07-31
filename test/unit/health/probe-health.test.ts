import { describe, expect, it } from "vitest";
import { probeHealth } from "../../../src/worker/health/probe-health.js";

describe("component health probes", () => {
  it("marks a successful bounded probe healthy", async () => {
    const result = await probeHealth({
      component: "database",
      timeoutMs: 50,
      probe: async () => ({ detail: "Connection accepted" }),
    });

    expect(result.status).toBe("healthy");
    expect(result.detail).toBe("Connection accepted");
    expect(result.checkedAt).toBeInstanceOf(Date);
  });

  it("marks a timed-out probe down without exposing the thrown error", async () => {
    const result = await probeHealth({
      component: "dograh",
      timeoutMs: 5,
      probe: async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
        throw new Error("Authorization: Bearer should-not-leak");
      },
    });

    expect(result.status).toBe("down");
    expect(result.detail).toBe("Probe timed out");
    expect(JSON.stringify(result)).not.toContain("should-not-leak");
  });

  it("aborts the underlying operation when a probe times out", async () => {
    let aborted = false;
    const result = await probeHealth({
      component: "dograh",
      timeoutMs: 5,
      probe: (signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal.reason);
            },
            { once: true },
          );
        }),
    });

    expect(result).toMatchObject({ status: "down", detail: "Probe timed out" });
    expect(aborted).toBe(true);
  });
});
