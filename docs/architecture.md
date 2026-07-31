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

## Application shape

A single TypeScript repository contains:

- React/Vite browser client;
- Fastify API, webhook, and SSE server;
- separately started outbox/health worker;
- PostgreSQL operational database.

The browser and process memory are never authoritative operational stores.

## Runtime decision

Development reuses the installed Node.js 22.22.2 runtime. The package requires Node.js `>=22.12.0`, which satisfies TypeScript 7, Vite 8, Vitest 4, and Playwright requirements without downloading an additional runtime.

## Private data

The existing root CSV files are private operational inputs. They are explicitly ignored, remain unchanged, and are not test fixtures. Tests must use synthetic data only.
