import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app.js";
import { createDatabase } from "../../src/server/db/client.js";
import { migrateDatabase } from "../../src/server/db/migrate.js";
import { organizations } from "../../src/server/db/schema/organizations.js";
import { appendEvent } from "../../src/server/events/event-ledger.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

if (!databaseUrl) {
  throw new Error("TEST_DATABASE_URL is required for SSE integration tests");
}

const connection = createDatabase(databaseUrl);

beforeAll(async () => {
  await migrateDatabase(connection.db);
});

afterAll(async () => {
  await connection.close();
});

describe("operation event SSE", () => {
  it("opens the stream before the first event exists", async () => {
    const organizationId = randomUUID();
    await connection.db
      .insert(organizations)
      .values({ id: organizationId, name: "Empty SSE test" });

    const app = buildApp({ database: connection.db });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    let timeout: NodeJS.Timeout | undefined;

    try {
      const response = await Promise.race([
        fetch(`${address}/api/events?organizationId=${organizationId}`, {
          signal: controller.signal,
        }),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("SSE headers were not flushed")), 250);
        }),
      ]);

      expect(response.headers.get("content-type")).toContain("text/event-stream");
      if (timeout) {
        clearTimeout(timeout);
      }
      const read = await Promise.race([
        response.body?.getReader().read(),
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => reject(new Error("SSE opening frame was not sent")), 250);
        }),
      ]);
      expect(new TextDecoder().decode(read?.value)).toContain(": connected");
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      controller.abort();
      await app.close();
    }
  });

  it("replays durable events after Last-Event-ID", async () => {
    const organizationId = randomUUID();
    await connection.db.insert(organizations).values({ id: organizationId, name: "SSE test" });
    const event = await appendEvent(connection.db, {
      organizationId,
      eventType: "health.checked",
      payload: { component: "database", status: "healthy" },
    });

    const app = buildApp({ database: connection.db });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();

    try {
      const response = await fetch(`${address}/api/events?organizationId=${organizationId}`, {
        headers: { "Last-Event-ID": String(event.id - 1) },
        signal: controller.signal,
      });
      const reader = response.body?.getReader();
      let body = "";
      for (let readCount = 0; readCount < 2 && !body.includes(`id: ${event.id}`); readCount += 1) {
        const read = await reader?.read();
        body += new TextDecoder().decode(read?.value);
      }

      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(body).toContain(`id: ${event.id}`);
      expect(body).toContain("event: health.checked");
      expect(body).toContain('"component":"database"');
    } finally {
      controller.abort();
      await app.close();
    }
  });
});
