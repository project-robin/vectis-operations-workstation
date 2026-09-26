# Robust MVP implementation status

Audit date: 2026-08-31

Source of truth: `2026-08-29_141850-vectis-robust-mvp.md`

## Executive finding

Tasks 2-9 now have complete deterministic implementations on the approved Next.js + Convex + Clerk stack. The local verification lane passes unit, function, contract, build, browser-bundle, and browser-smoke gates. Tasks 10-14 are not started. Live Convex/Clerk, Dograh, Twenty, storage, and commercial-source verification remains explicitly credential-gated and is not substituted by synthetic tests.

The current branch does remove the tracked Fastify, PostgreSQL/Drizzle, Vite application, standalone worker, migrations, and their tests. The intended runtime is now only Next.js App Router, Convex, and Clerk. Vitest remains the test runner; its transitive implementation packages are test tooling, not an application runtime.

## Verification snapshot

| Check | Result | Evidence |
|---|---|---|
| Unit/function/component/contract tests | Pass | `npm test`: 23 files, 170 tests passed across Tasks 2-9 |
| TypeScript | Pass | `npm run typecheck` passes |
| Lint/format check | Pass | `npm run format-check` and `npm run lint` pass on the declared application scope |
| Production build | Pass | `npm run verify` supplies explicit synthetic public Clerk/Convex values through its verification caller; `npm run build` itself fails when required values are absent |
| Browser E2E | Pass | Two Playwright smoke/protection tests pass using installed Chrome/Chromium; no browser download occurs |
| CI | Deterministic + credential-gated | The default job is synthetic and credential-free; the separate protected job executes only with its deployment/session/HTTP variables and an explicit skip is not proof |

Tasks 2-9 are deterministic-test complete. Live provider/deployment verification remains external and credential-gated.

## Task-by-task status

### Task 0 — Partial

- The dirty tree is inventoried and the tracked legacy stack is staged for deletion.
- There is no durable file-level change manifest from the implementation sessions.
- The plan still described a side-by-side legacy migration; that rule is now superseded by ADR-0003 and the approved clean Next.js/Convex/Clerk baseline.

### Task 1 — Substantially complete, business decisions still open

Implemented:
- `CONTEXT.md`
- product and page contracts
- ADRs for ownership, attribution, and platform
- architecture and integration documentation

Open product decision:
- Commercial metrics remain in shadow mode until owner-approved source mappings, recovery policy, and live Twenty/business comparisons pass Task 9 readiness checks.

### Task 2 — Deterministic lane complete; protected proof credential-gated

Implemented:
- pinned Next.js, React, Convex, Clerk, Vitest, and `convex-test`
- App Router shell and provider nesting
- Convex schema/auth/http/cron seams
- basic CI and focused toolchain/component tests

Task 2 evidence:
- `middleware.ts` uses the pinned Clerk 6.39.6 `clerkMiddleware` API and protects `/workstation` plus API routes
- `convex/convex.config.ts` and a non-empty `convex.json` establish the Convex project configuration
- toolchain query, mutation, and scheduler seams require an authenticated Convex identity
- `convex/nodeActions.ts` proves a Node action using `fetch`
- Vitest projects cover Convex/node and jsdom component environments, including provider/auth/reactive hook seams
- `npm run verify` provides deterministic format, lint, read-only generated-structure, stack, typecheck, synthetic-test, build, and browser gates
- Playwright smoke uses an installed browser executable or an explicit executable path and does not download binaries
- TypeScript 5.9.3 and `convex-test` 0.0.56 are pinned exactly; TypeScript 7 is not available in this dependency set
- Clerk issuer/provider and Convex client configuration fail fast instead of falling back to empty values
- `npm run verify:protected` is the only lane that invokes official Convex codegen or claims real Clerk/Convex authentication, reactive mutation updates, and HTTP behavior; it skips when its protected variables are absent

The default lane does not regenerate `_generated` files and does not claim that the checked-in artifacts are synchronized with a deployment. Run `npm run codegen:protected` through the protected lane with `CONVEX_DEPLOYMENT` to refresh them using the official generator. A skipped protected CI job is not proof of integration.

### Task 3 — Deterministic coverage complete; protected verification blocked

Implemented:
- `convex/lib/auth.ts` deep identity, user, active-membership, role-hierarchy, permission, and duplicate-row fail-closed helpers
- Clerk profile and lifecycle fields on users, organizations, and memberships; tenant-first indexes plus a bounded metadata-only webhook idempotency ledger
- authoritative `convex/users.ts` and `convex/organizations.ts` read/admin APIs; no public identity ensure/update/bootstrap surface and no duplicate `convex/tenancy.ts` facade
- Clerk webhook is the only identity lifecycle writer; verified bounded event timestamps enforce stale-event ordering, terminal deletes, and explicit created-event recreation
- official Clerk role-key mapping (`org:admin`, `org:operator`, `org:staff`, `org:member`) with unknown roles failing closed
- signed Clerk Standard Webhooks verification through the installed `@clerk/backend/webhooks` `verifyWebhook` API at `/clerk/webhook`
- idempotent user, organization, and organization-membership create/update/delete lifecycle handling with deactivation rather than destructive history loss
- owner/operator/staff hierarchy and explicit read/operate/manage-members/approve permission matrix
- `middleware.ts` protects workstation/private API routes; the Convex `/clerk/webhook` endpoint is separate and signature-verified, with no nonexistent Next `/api/webhooks/clerk` exception
- synthetic Convex, webhook SDK/HTTP, middleware, browser-boundary, duplicate-row, inactive, role, and cross-tenant tests
- complete public-function inventory and role matrix in `docs/task3-security-matrix.md`
- signed-route tests for missing secret/signature, invalid and valid signatures, replay, method, empty, declared oversize, streamed/chunked oversize, timestamp, and conflicting duplicate payloads
- emitted production `.next/static` bundle scan for server-only environment names and synthetic secret sentinels, wired into `npm run verify` after build
- protected fixture contract requiring explicit disposable-tenant IDs, owner/operator/staff session states and roles, with honest absent/partial configuration handling

Verification in this tranche:
- Focused authority/lifecycle lane covers absent public identity writers, unknown member targets, official role mapping, stale/out-of-order events, terminal deletes/recreation, parent-delete membership handling, pair mismatch, duplicate replay/conflict, metadata-only ledger storage, and middleware route alignment.
- Live Clerk/Convex proof remains external and credential-gated through `npm run verify:protected`; Task 3 remains protected-verification-blocked until all disposable fixture variables exist. No real credentials are committed or inferred.

No Task 3 implementation relies on Dograh or Hermes secrets; those boundaries remain separate.

### Task 4 — Deterministic coverage complete; protected verification remains separate

Implemented:
- `organizationSettings` and `integrationBindings` with tenant-first indexes, additive optional metadata, duplicate fail-closed reads, and Convex OCC-safe read-before-insert reservations.
- Owner-only settings/binding writes, active-member reads, cross-tenant resource validation, append-only operation events with actor/tenant/target/correlation metadata, and no client-supplied organization ID.
- Validated IANA timezone, uppercase ISO 4217 currency, bounded interaction-to-outcome attribution window, business vertical, expected booking value modes (`none`, `org_wide`, `service`, `opportunity`) with integer minor-unit/currency rules, and bounded health freshness.
- Non-secret Dograh/Twenty/Hermes binding metadata, provider-specific identifiers/mappings, active/inactive health state, and deployment secret reference names only. Credential-shaped fields and metadata are rejected.
- Internal explicit-organization binding resolver that revalidates active organization/binding and returns metadata plus secret reference names, never secret values.
- Organization lifecycle provisioning defaults: UTC, INR, 30 days, opportunity-derived booking value, and 15/60-minute health freshness. Owners can safely initialize legacy organizations idempotently.
- Organization-policy-aware date, money, and attribution helper seams.

Focused `convex/organizationSettings.test.ts` coverage includes validation boundaries, role/inactive/cross-tenant checks, duplicate and secret rejection, lifecycle defaults, internal resolution, date boundaries, and currency formatting. Live protected verification still requires the existing disposable Clerk/Convex fixture and is not claimed here.

### Task 5 — Deterministic implementation complete; protected codegen/live storage proof remains external

Implemented:
- Convex storage-backed `sourceArtifacts` with sanitized filenames, MIME/size/checksum validation, same-tenant dedupe, tenant-safe metadata and URL reads.
- Additive `importRows` alongside the legacy `sourceRows` mirror, with immutable raw/evidence fields, mapping version, validation/exclusion state, consent, and bounded eligibility reads.
- Canonical customer identities, cross-batch resolution, duplicate fail-closed checks, explicit ambiguity review, owner resolution, owner-only audited merges, and tenant-first customer pagination/search.
- One idempotent opportunity per organization/source pursuit, source-row/customer cross-validation, integer minor-unit values with organization currency policy, owner override for excluded rows, role checks, and terminal outcomes.
- Focused `convex/imports.test.ts` and `convex/opportunities.test.ts` coverage plus retained Task 5 regression coverage in `convex/customers.test.ts`.

The protected lane still needs deployed Convex codegen and live Clerk/Convex credentials. `convex-test` does not implement the storage metadata syscall, so deterministic artifact tests seed Convex storage and exercise registration through the supported system metadata seam; live upload URL/read-back remains protected-lane work.

### Task 6 — Deterministic implementation complete; protected/live proof external

Implemented:
- Tenant-first, additive `providerRuns`, `conversations`, `interactions`, and versioned `callOutcomes` schema fields and global correlation indexes.
- Framework-neutral v1 business-outcome contract with reached/qualified/resolution, booking-request, follow-up, handoff, quote, payment-promise, dispute, sentiment, summary, and bounded custom fields. Provider context cannot set booking confirmation.
- Read-only Dograh-source-backed inbound/outbound renderer fixtures and documented string/empty/boolean/null behavior.
- Globally collision-safe pre-registration by opaque workstation correlation, with organization/customer/campaign validation.
- Dedicated constant-time-secret, bounded, schema-validating `POST /dograh/webhook` Convex ingress with no organization trust from payloads.
- Atomic, idempotent callback projection that updates the pre-registered run, composes conversations/interactions/outcomes, appends one event, and reserves one pending downstream delivery intent without invoking Task 7.
- Authenticated tenant-scoped bounded/paginated conversation and customer timeline queries over authoritative imports, interactions/outcomes, opportunities, appointments, work items, and commercial facts.
- Recursive raw-context redaction/limits and safe recording/transcript reference validation.
- Comprehensive synthetic Convex/HTTP tests in `convex/task6.test.ts`.

The live Dograh callback and protected Convex deployment/codegen verification remain credential-gated external work.
### Task 7 — Deterministic implementation complete; live Twenty remains credential-gated

Implemented:
- Durable tenant-first appointments with requested/confirmed/cancelled/no-show/completed lifecycle, linked customer/conversation/outcome/opportunity evidence, and authoritative external ID/read-back confirmation.
- Durable human work items with bounded tenant-scoped reads, owner/operator/staff access policy, active same-tenant assignee validation, legal transitions, audited resolution, and proposal-only follow-ups.
- Idempotent typed outcome projection for handoff, dispute, and follow-up outcomes; duplicate callbacks converge on one work item, appointment, event, and delivery intent.
- Delivery outbox reservation, lease-token claims, stale-lease recovery, bounded determinate retries, ambiguous/reconciliation-required states, explicit reconciliation, payload version/hash, provider IDs, and exact read-back evidence.
- Narrow Twenty Streamable HTTP adapter with initialize/session handling, JSON/SSE parsing, timeouts, byte bounds, typed errors, exact create/search read-back, and correct person/note/task/appointment mapping. Actions require an active explicit-tenant binding and environment secret reference; no secret values are persisted or logged.
- Synthetic Convex domain tests and a local fake Streamable HTTP MCP contract suite covering success, mapping, duplicate claims, timeout, 5xx, malformed SSE, orphan read-back, stale leases, and max attempts.

The deterministic Task 7 lane is green. Live Twenty delivery remains credential-gated and was not claimed or executed.

### Task 8 — Deterministic implementation complete; live Dograh protected lane remains optional

Implemented:
- Additive campaigns, campaign members, and reconciliation work-item schema with tenant-first indexes, legacy status backfill, independent business/provider/member dispositions, binding/agent/provider IDs, claims, progress, audit, and error fields.
- Authenticated bounded campaign list/get APIs; operator draft creation from exactly one approved Task 5 batch and only valid, resolved, consented rows; owner approval.
- Atomic start/pause/resume transitional claims with idempotency keys, legal transitions, audited events, and no concurrent duplicate provider mutation.
- Node Dograh adapter using the source-derived `/api/v1` upload/create/get/start/pause/resume/progress/runs/report routes, environment-only secret references, bounded CSV generation/upload, exact read-backs, and ambiguous mutation errors that fail closed.
- Read-only workflow canary; telephony is explicitly reported as unknown because no supported generic telephony prerequisite endpoint was inferred.
- Bounded reconciliation action/cron, monotonic provider terminal handling, progress persistence, callback member projections, explicit owner/operator human reconciliation decisions, and additive backfill mutation.
- Fake HTTP Dograh contract tests plus Convex domain tests covering route/auth/correlation, CSV bounds/escaping, claim races, idempotency, tenant isolation, terminal monotonicity, and ambiguous transport failures.

The protected live lane is intentionally not enabled by default. It requires explicit Dograh credentials and a disposable organization; no live mutation is performed by the synthetic verification lane.

### Task 9 — Deterministic implementation complete; live Twenty schema comparison remains external

Implemented:
- Additive `commercialOutcomes`, `attributions`, `opportunityStateEvidence`, and bounded `commercialComparisons` tables with tenant-first source/time/status/currency/opportunity/interaction/provider-run indexes.
- Integer minor-unit/ISO-currency commercial fact ingestion with source idempotency, same-tenant link validation, explicit internal-tenant provider ingestion, authoritative booking/payment gates, evidence references/hashes, confidence, coverage, and shadow/publication state.
- Configurable Task 4 commercial policy: shadow-by-default mode, booking/payment authority sources, recovery window and allowed prior states, owner-only readiness-gated publication.
- Pure deterministic attribution with organization window, latest-preceding interaction selection, stable tie-break, inspectable rule/version/explanation, explicit persisted prior-state evidence, and recovered-as-subset enforcement.
- Authenticated Home/Analytics summary and bounded drilldown queries with separate estimated/confirmed/collected totals, currency segregation, zero-safe funnel denominators/conversions, definitions, warnings, verification time, state, and drilldown queries.
- Read-only Twenty opportunity/payment action seams through the existing Task 7 MCP adapter. Mapping is required and live coverage remains `unknown`; no unsupported live schema or writes were inferred.
- Focused `convex/task9.test.ts` and fake Twenty read contract coverage for money, idempotency, tenant isolation, authority, attribution, recovery ordering, shadow blockers, pagination/card equality, currencies, and read-only MCP behavior.

The live Twenty schema comparison remains an external blocker. Commercial metrics remain shadow until a verified mapping/comparison passes all readiness checks; no live credentials or schema assumptions are committed.

### Tasks 10-14 — Not started

The current UI is a single shell page. There are no six owner routes, operations routes, agent registry, Ask Vectis command lifecycle, insights, production runbooks, recovery drill, or counted pilot.

## External verification still required

1. Run official Convex codegen and the protected Clerk/Convex tenant fixture against a disposable deployment.
2. Exercise one consented Dograh campaign/callback through the live Vectis organization and reconcile campaign/run state.
3. Exercise Twenty person/note/task/appointment delivery against the live MCP schema with exact read-back.
4. Compare Task 9 shadow commercial facts against authoritative Twenty/business records before enabling published metrics.
5. Keep commercial metrics shadowed and external mutations disabled until these protected checks pass.

## Recommended next implementation point

Start Task 10: build the six owner routes and operations drawer on top of the verified Tasks 2-9 Convex contracts. Then continue Tasks 11-14 for Agents, Ask Vectis, insights, deployment/recovery, and the counted pilot.
