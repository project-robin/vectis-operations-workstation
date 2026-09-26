# Vectis Operations Workstation Architecture

## Repository boundary

- Product root: `/home/map/project-z/hermes-vectis`
- Dograh provider root: `/home/map/project-z/voice-agent/voice-agent-v1`
- Dograh is read-only by default for Workstation implementation.
- Integration uses supported APIs, authenticated webhooks, MCP, or adapters.

## Responsibilities

- **Workstation:** provenance, eligibility, imports, approvals, correlation, operational events, health, outbox delivery, audit, and owner/operator UI.
- **Dograh:** voice workflows, campaigns, calling queues, schedules, retries, calls, recordings, and transcripts.
- **Twenty:** CRM contacts, notes, opportunities, tasks, and appointment records.
- **Hermes:** owner-facing manager using narrow Workstation tools; never a live-call participant.

## Application shape (see ADR-0003)

The application uses only Next.js App Router + Convex + Clerk. The retired server, database, browser-client, and worker implementations remain available only in Git history; no compatibility runtime or dual-write path is retained. Platform seams:

- `app/`, `components/`, `lib/` — Next.js pages, shell, UI helpers;
- `convex/` — schema, public queries/mutations, internal mutations/actions, HTTP routes, crons, domain modules;
- `scripts/` — verified administrative tools only.

Convex HTTP actions own external webhook ingress; Convex mutations are the atomic state-transition seam; Convex subscriptions replace custom SSE; append-only operation events remain durable audit history. Clerk supplies identity; every Convex function independently enforces organization membership and role.

## Runtime decision

Development reuses the installed Node.js 22.22.2 runtime. The package requires Node.js `>=22.12.0`, which satisfies the Next.js, Convex, Clerk, TypeScript, Vitest, and Playwright requirements without downloading an additional runtime.

## Private data

The existing root CSV files are private operational inputs. They are explicitly ignored, remain unchanged, and are not test fixtures. Tests must use synthetic data only.
