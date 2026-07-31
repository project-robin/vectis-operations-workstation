import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { DograhClient } from "../../src/server/adapters/dograh/client.js";

describe("Dograh campaign client", () => {
  it("uploads CSV and controls a campaign through authenticated API calls", async () => {
    const app = Fastify();
    let baseUrl = "";
    let uploadedCsv = "";
    let state = "created";
    const campaign = () => ({
      id: 7,
      name: "Synthetic campaign",
      workflow_id: 9,
      state,
      source_id: "campaigns/1/synthetic.csv",
      total_rows: 1,
      processed_rows: state === "running" ? 1 : 0,
      failed_rows: 0,
    });

    app.addContentTypeParser("text/csv", { parseAs: "string" }, (_request, body, done) => {
      done(null, body);
    });
    app.addHook("preHandler", async (request, reply) => {
      if (request.url !== "/upload" && request.headers["x-api-key"] !== "test-key") {
        return reply.status(401).send({ error: "unauthorized" });
      }
    });
    app.post("/api/v1/s3/presigned-upload-url", async () => ({
      upload_url: `${baseUrl}/upload`,
      file_key: "campaigns/1/synthetic.csv",
      expires_in: 900,
    }));
    app.put("/upload", async (request) => {
      uploadedCsv = request.body as string;
      return "";
    });
    app.post("/api/v1/campaign/create", async () => campaign());
    for (const action of ["start", "pause", "resume"] as const) {
      app.post(`/api/v1/campaign/7/${action}`, async () => {
        state = action === "pause" ? "paused" : "running";
        return campaign();
      });
    }
    app.get("/api/v1/campaign/7/progress", async () => ({
      campaign_id: 7,
      state,
      total_rows: 1,
      processed_rows: 1,
      failed_calls: 0,
      progress_percentage: 100,
    }));

    try {
      baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
      const client = new DograhClient(baseUrl, "test-key");
      const sourceId = await client.uploadCampaignCsv(
        "synthetic.csv",
        "phone_number,workstation_lead_id\n+447700900123,lead-1\n",
      );
      const created = await client.createCampaign({
        name: "Synthetic campaign",
        workflowId: 9,
        sourceId,
      });

      expect(uploadedCsv).toContain("workstation_lead_id");
      expect(created).toMatchObject({ id: 7, state: "created" });
      expect(await client.startCampaign(7)).toMatchObject({ state: "running" });
      expect(await client.pauseCampaign(7)).toMatchObject({ state: "paused" });
      expect(await client.resumeCampaign(7)).toMatchObject({ state: "running" });
      expect(await client.getCampaignProgress(7)).toMatchObject({
        campaignId: 7,
        progressPercentage: 100,
      });
    } finally {
      await app.close();
    }
  });
});
