import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { handle as clerkWebhook } from "./http/clerkWebhook";
import { handle as dograhCallEvents } from "./http/dograhCallEvents";
import { handle as dograhWebhook } from "./http/dograhWebhook";

const ping = httpAction(async () =>
  Response.json({ ok: true, service: "vectis-workstation-convex" }),
);

const routes = httpRouter();
routes.route({ path: "/ping", method: "GET", handler: ping });
routes.route({ path: "/clerk/webhook", method: "POST", handler: clerkWebhook });
routes.route({ path: "/dograh/webhook", method: "POST", handler: dograhWebhook });
routes.route({ path: "/dograh/webhook", method: "GET", handler: dograhWebhook });
// Calling console: post-call notifications from the Dograh Webhook node.
routes.route({ path: "/dograh/call-events", method: "POST", handler: dograhCallEvents });

// Provider callbacks land here in their dedicated task; Next.js Route Handlers
// must not duplicate Convex HTTP actions (ADR-0003).
export default routes;
