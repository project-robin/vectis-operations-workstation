import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "../db/client.js";
import { listEventsAfter } from "../events/event-ledger.js";

const eventQuerySchema = z.object({
  organizationId: z.uuid(),
});

function parseLastEventId(value: string | string[] | undefined): number | null {
  if (value === undefined) {
    return 0;
  }

  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function registerEventRoutes(app: FastifyInstance, database: Database): void {
  app.get("/api/events", async (request, reply) => {
    const query = eventQuerySchema.safeParse(request.query);
    const lastEventId = parseLastEventId(request.headers["last-event-id"]);

    if (!query.success || lastEventId === null) {
      return reply.status(400).send({ error: "Invalid event stream request" });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    });
    reply.raw.flushHeaders();
    reply.raw.write(": connected\n\n");

    let cursor = lastEventId;
    let closed = false;
    let timer: NodeJS.Timeout | undefined;

    const close = () => {
      closed = true;
      if (timer) {
        clearTimeout(timer);
      }
    };

    request.raw.once("close", close);

    const poll = async (): Promise<void> => {
      try {
        const events = await listEventsAfter(database, {
          organizationId: query.data.organizationId,
          afterId: cursor,
        });

        for (const event of events) {
          reply.raw.write(`id: ${event.id}\n`);
          reply.raw.write(`event: ${event.eventType}\n`);
          reply.raw.write(`data: ${JSON.stringify(event.payload)}\n\n`);
          cursor = event.id;
        }
      } catch {
        reply.raw.write('event: stream.error\ndata: {"message":"Event stream unavailable"}\n\n');
        reply.raw.end();
        close();
        return;
      }

      if (!closed) {
        timer = setTimeout(() => void poll(), 1000);
      }
    };

    await poll();
  });
}
