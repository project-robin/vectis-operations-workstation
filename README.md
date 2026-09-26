# Vectis Operations Workstation

A standalone operations control plane for consented lead imports, Dograh voice campaigns, Twenty CRM delivery, audit, and human oversight — built on **Next.js + Convex + Clerk**.

- **Workstation** owns provenance, consent checks, staged imports, approvals, correlation, operational events, delivery state, audit, and owner/operator views.
- **Dograh** owns voice workflows, campaign execution, telephony, recordings, transcripts, retries, and redial.
- **Twenty** owns CRM contacts and call-outcome records.
- **Hermes** acts as the owner-facing manager through a narrow authenticated surface; it does not participate in customer calls.

> **Status:** robust-MVP implementation in progress. Tasks 6-9 are deterministic-test complete for callback projections, durable operations, commercial evidence, deterministic attribution, shadow analytics, and read-only Twenty seams; live Dograh/Twenty/Convex verification remains credential-gated, and live Twenty schema comparison is still required before publishing metrics. Task 4 organization policy and non-secret integration bindings are deterministic-test complete. Next.js + Convex + Clerk is the only application architecture; retired implementations remain only in Git history. See the current audit in `docs/implementation-status.md` and [Task 4 decisions](docs/task4-organization-policy.md).

## Application shape

- Next.js App Router UI (`app/`, `components/`);
- Convex backend: schema, queries/mutations, internal actions, HTTP webhook ingress, scheduler (`convex/`);
- Clerk authentication with Convex-enforced organization membership and roles;
- Vitest + `convex-test` for function tests.

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
  -> authenticated terminal callback (Convex HTTP action)
  -> durable Workstation projection and event trace
  -> one pending downstream delivery intent for Task 7
```

Imports never auto-dial. Campaign execution requires explicit approval, and ambiguous external mutations fail closed for reconciliation.

## Requirements

- Node.js 22.12 or newer
- npm
- a Convex deployment for real authenticated use (`npx convex dev`)
- Clerk keys for real authentication
- a reachable Dograh API with campaign and telephony configuration
- a Twenty MCP endpoint and API credential for CRM delivery

## Setup

```bash
npm ci
cp .env.example .env.local
npx convex dev   # provisions a deployment and prints NEXT_PUBLIC_CONVEX_URL
```

Set `NEXT_PUBLIC_CONVEX_URL` and `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` in `.env.local`; set `CLERK_ISSUER_DOMAIN`, `CLERK_WEBHOOK_SIGNING_SECRET`, and `CLERK_SECRET_KEY` only in the appropriate Convex/Next deployment environment (`npx convex env set ...`). The app intentionally fails fast when these runtime values are missing.

### Development processes

```bash
npm run dev          # Next.js UI
npm run dev:convex   # Convex functions (separate terminal)
```

## Verification

```bash
npm run verify
```

`npm run verify` runs the credential-free deterministic lane: format, lint, a read-only generated-artifact structure check, the retired-stack check, TypeScript, synthetic Vitest/`convex-test`, a production build, an emitted `.next/static` browser-bundle secret scan, and the browser smoke test. The verification caller explicitly supplies `NEXT_PUBLIC_CONVEX_URL=https://task2-synthetic.invalid` and the syntactically valid test-only `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_Y2xlcmsuZXhhbXBsZS5jb20k`; build and browser tooling never inject deployment fallbacks. This lane does not run official Convex codegen or claim real Clerk/Convex authentication, subscriptions, or HTTP behavior. The structure check reports a skip when official artifacts are absent or local placeholders are present; it never treats placeholders as proof.

`npm run verify:protected` is the separate real-backend lane. It requires the protected deployment identity, `CONVEX_DEPLOY_KEY`, Clerk publishable key, storage state, and the Convex `.convex.site` HTTP URL derived from and matched to `NEXT_PUBLIC_CONVEX_URL`; it rejects partial, credential-bearing, port-bearing, or unrelated configuration without printing secret values. The deploy key is checked with Convex's official deployment metadata endpoint before child processes run. It runs official `npx --no-install convex codegen`, generated-structure validation, typecheck, a protected production build, starts this workspace locally against that same Convex URL, and runs the real Clerk-authenticated subscription/mutation, unauthenticated workstation denial, and HTTP `/ping` checks. When all `TASK3_PROTECTED_*` fixture values are configured, it also runs explicit owner/operator/staff role checks and a disposable cross-tenant resource-substitution check with cleanup. Without those fixture values, it reports Task 3 as protected-verification-blocked rather than claiming live proof; partial Task 3 configuration fails. Generated artifacts are never fabricated by an offline script; `npm run check-generated-structure` only checks their presence and basic exports. For local configuration-free checks only, set `TASK2_ALLOW_LOCAL_PROTECTED_SKIP=1`; CI uses a non-secret preflight output so the protected job is visibly skipped when no protected configuration exists.`

## Security boundaries

- Clerk authenticates identity; every tenant-owned Convex function independently enforces authoritative Convex organization membership and role.
- Clerk lifecycle events are accepted only through the signed `/clerk/webhook` Convex HTTP action; user, organization, and membership deactivation is retained as audit-safe history.
- The complete Task 3 role matrix, public Convex inventory, lifecycle invariants, webhook cases, and protected-fixture contract are documented in [docs/task3-security-matrix.md](docs/task3-security-matrix.md).
- The toolchain proof seam is internal-only, uses fixed request targets, and bounds labels, payloads, indexed queries, and per-organization retention.
- Dograh callbacks use a dedicated `X-Dograh-Webhook-Secret` boundary.
- Every tenant-owned query is scoped by `organizationId`.
- Organization settings are tenant-scoped and owner-managed: timezone, ISO currency, attribution window, expected booking value, shadow/published commercial mode, booking/payment authority, recovery definition/window, business vertical, and health freshness are durable policy rather than global environment defaults.
- Commercial facts use integer minor units and explicit currency; estimated, confirmed, and collected values remain separate. Recovered value is an attributed subset, never an additive revenue bucket. Home/Analytics stay shadow until a verified comparison passes readiness checks, and every aggregate carries a bounded drilldown and coverage warnings.
- Dograh, Twenty, and Hermes bindings store provider metadata and secret reference names only. Internal action resolvers revalidate explicit active organizations/bindings and never return secret values.
- Delivery idempotency is unique per organization and idempotency key.
- Campaign provider mutations use atomic transitional claims and do not automatically retry ambiguous outcomes.
- The manager surface exposes a fixed allowlist — no arbitrary SQL, shell, generic HTTP, or provider-tool forwarding.

See [docs/architecture.md](docs/architecture.md), [docs/integration-contracts.md](docs/integration-contracts.md), and [CONTEXT.md](CONTEXT.md) for details.

## Private data

Use `private-inputs/` or a `*.private.csv` filename for local operational files. These paths are ignored by Git. Tests use synthetic fixtures only.

## License

No open-source license has been selected yet. The repository remains private and all rights are reserved unless a license is added.
