import { describe, expect, it, vi } from "vitest";
import { getComponentHealth } from "../../../src/web/api/health.js";

describe("health API client", () => {
  it("returns validated component health", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          components: [
            {
              id: 1,
              organizationId: "00000000-0000-4000-8000-000000000001",
              component: "database",
              status: "healthy",
              detail: "Connection accepted",
              latencyMs: 3,
              checkedAt: "2026-07-31T00:00:00.000Z",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await getComponentHealth("00000000-0000-4000-8000-000000000001", fetcher);

    expect(fetcher).toHaveBeenCalledWith(
      "/api/health/components?organizationId=00000000-0000-4000-8000-000000000001",
    );
    expect(result[0]).toMatchObject({ component: "database", status: "healthy" });
  });

  it("rejects malformed provider data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ components: [{ status: "green" }] })));

    await expect(
      getComponentHealth("00000000-0000-4000-8000-000000000001", fetcher),
    ).rejects.toThrow();
  });
});
