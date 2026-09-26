# Calling console

The owner-facing loop: **leads → Dograh calls → results in Vectis → Twenty CRM**.

## How the systems connect

```text
Vectis (Next.js + Convex)                 Dograh Cloud                     Twenty CRM
  Leads (CSV / Twenty / manual)
  "Call leads"  ── campaign CSV upload ──▶ campaign (batching, retries)
  "Quick call"  ── API trigger + brief ──▶ "Vectis Custom Call" agent
                ◀── Webhook node (run id, X-Vectis-Secret) ── after every call
  fetch run (summary, answers, transcript) ◀──
  call record + dashboard
                ── REST: person, note, follow-up task ─────────────────────▶ contact timeline
```

- **No Dograh SDK or MCP in the app.** `@dograh/sdk` is for authoring workflow code and the
  Dograh MCP is for AI assistants. The app uses Dograh's REST API from Convex actions.
- **No Twenty MCP in the app.** CRM writes are fixed operations, so Convex uses Twenty's REST API.
- **Dograh never gets the Twenty key.** Dograh's post-call Webhook node notifies Vectis with the
  run id only; Vectis re-reads the authoritative run from the Dograh API and writes to Twenty.
  A one-minute cron (`call-result-poll`) reconciles anything the webhook missed.

## Setup

1. Put `DOGRAH_API_KEY`, `TWENTY_API_KEY`, and `NEXT_PUBLIC_CONVEX_SITE_URL` in `.env.local`.
2. `npx convex dev --once` (deploys functions, including `/dograh/call-events`).
3. `node scripts/setup-dograh-agents.mjs --lead-workflow-id <id>` — idempotent. It creates/updates
   the "Vectis Custom Call" agent (API trigger + webhook), adds the webhook and call-summary
   extraction to the lead agent, and writes all keys and ids into the Convex environment.
4. Clerk: a JWT template named `convex` with `aud: "convex"` (matches `convex/auth.config.ts`).
5. `npm run dev`, sign in. The first sign-in creates the user's personal workspace.

Rotating the Twenty key: `npx convex env set TWENTY_API_KEY <key>`.

## Code map

| Concern | File |
|---|---|
| Workspace auto-provisioning, settings | `convex/workspace.ts` |
| Leads import/list/stats | `convex/leads.ts` |
| Quick calls, campaigns, webhook/poll reconciliation, CRM sync | `convex/calls.ts` |
| Dograh run → call result mapping | `convex/lib/callResult.ts` |
| Twenty REST client, CRM note format | `convex/lib/twentyRest.ts`, `convex/lib/crmNote.ts` |
| Webhook ingress | `convex/http/dograhCallEvents.ts` |
| Pages | `app/{page,quick-call,leads,calls,campaigns,settings}`, `components/pages/*` |

## Twilio trial limitation

The Dograh org uses a Twilio trial number, which can only dial verified numbers. Calls to any other
number fail and show up as "Failed" with Twilio's error.
