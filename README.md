# Vectis Operations Workstation

A standalone operations control plane for consented lead imports, Dograh voice campaigns, Twenty CRM delivery, audit, and human oversight.

The Workstation does not replace Dograh or Twenty:

- **Workstation** owns provenance, consent checks, staged imports, approvals, correlation, operational events, delivery state, audit, and operator views.
- **Dograh** owns voice workflows, campaign execution, telephony, recordings, transcripts, retries, and redial.
- **Twenty** owns CRM contacts and call-outcome records.
- **Hermes** acts as the owner-facing manager through a narrow authenticated MCP surface; it does not participate in customer calls.

> **Status:** development MVP. Automated tests and security review pass, but production deployment hardening and the first live end-to-end pilot are still in progress.

## Application shape

This repository contains:

- React 19 + Vite operator UI;
- Fastify API, webhook, SSE, and manager MCP server;
- PostgreSQL operational state using Drizzle ORM;
- a separately started Twenty outbox worker;
- contract, integration, and unit tests with Vitest.

## Safe workflow

```text
CSV upload
  -> stage and validate
  -> review exclusions and consent
  -> commit
  -> approve
  -> create campaign draft
  -> approve campaign
  -> Dograh execution
  -> authenticated terminal callback
  -> durable Workstation projection and event trace
  -> idempotent Twenty outbox delivery
```

Imports never auto-dial. Campaign execution requires explicit approval, and ambiguous external mutations fail closed for reconciliation.

## Requirements

- Node.js 22.12 or newer
- npm
- PostgreSQL
- a reachable Dograh API with campaign and telephony configuration
- a Twenty MCP endpoint and API credential for CRM delivery

## Setup

```bash
npm install
cp .env.example .env
```

Configure `.env` with local credentials. Never commit `.env`, imported lead files, recordings, transcripts, or provider credentials.

Apply migrations by starting the API or worker; both run the checked-in Drizzle migrations automatically.

### Development processes

Run these separately:

```bash
npm run dev:server
npm run dev:web
npm run dev:worker
```

The API defaults to `127.0.0.1:4100`. A non-loopback bind is refused unless `WORKSTATION_API_KEY` is configured.

## Verification

```bash
npm run typecheck
npm run lint
TEST_DATABASE_URL=postgres://user:password@127.0.0.1:5432/test_database npm test
npm run build
```

The integration tests require a disposable PostgreSQL database through `TEST_DATABASE_URL`.

## Security boundaries

- Ordinary API routes require `X-Workstation-Key` whenever public binding is enabled.
- Dograh callbacks use a dedicated `X-Dograh-Webhook-Secret` boundary.
- Manager HTTP/MCP requests use a separate manager credential.
- Every tenant-owned query is scoped by `organizationId`.
- Outbox idempotency is unique per organization and idempotency key.
- Campaign provider mutations use atomic transitional claims and do not automatically retry ambiguous outcomes.
- The manager MCP exposes a fixed allowlist—no arbitrary SQL, shell, generic HTTP, or provider-tool forwarding.

See [docs/architecture.md](docs/architecture.md) and [docs/integration-contracts.md](docs/integration-contracts.md) for details.

## Private data

Use `private-inputs/` or a `*.private.csv` filename for local operational files. These paths are ignored by Git. Tests use synthetic fixtures only.

## License

No open-source license has been selected yet. The repository remains private and all rights are reserved unless a license is added.
