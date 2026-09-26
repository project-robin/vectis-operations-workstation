# Vectis Robust MVP Implementation Plan

> **For Hermes:** Use subagent-driven-development to implement this plan task-by-task. Preserve the current dirty working tree, use TDD for every behavior change, and do not commit unless the user explicitly asks.

**Goal:** Evolve the existing Vectis Operations Workstation into a trustworthy owner-facing application that proves business value, preserves complete customer context, coordinates AI agents and humans, and exposes a safe “Ask Vectis” management surface.

**Architecture:** Use a single Next.js App Router repository with Convex as the backend, database, realtime layer, HTTP webhook ingress, scheduler, and external-integration action runtime; use Clerk for user authentication. Next.js + Convex + Clerk is the only application platform. Do not retain or add compatibility code, dual writes, migration branches, or runtime dependencies for the retired implementation. Preserve Dograh execution ownership, Twenty CRM ownership, and the narrow Hermes manager interface. Deepen the Workstation around canonical customers, opportunities, structured outcomes, human work, appointments, commercial evidence, and manager commands; do not replace Dograh, duplicate its queue, turn Twenty into an execution queue, or split into premature microservices.

**Tech Stack:** Node.js 22+, TypeScript 7, Next.js App Router, React, Convex database/functions/actions/HTTP actions/scheduler/realtime subscriptions/file storage, Clerk authentication, Convex validators, Vitest with `convex-test`, Playwright, MCP SDK where runtime-compatible, Dograh REST/webhooks, Twenty native MCP from Convex Node actions, and Hermes native MCP/webhook or a bounded runner after a compatibility spike. Pin exact compatible versions only after Task 2 proves them together.

---

## 1. Executive finding: what this project was built for

The repository was not originally built as a generic CRM. It was built as a **standalone operational control plane** between three specialist systems:

The historical intent evolved in two clear steps. The July 1 plan (`.hermes/plans/2026-07-01_195910-dograh-twenty-hermes-business-automation.md`) first described Dograh + Twenty + Hermes as an interconnected business-automation system, with Hermes as the owner-facing co-founder/manager and Dograh as the customer-facing voice layer. Some of that old plan incorrectly placed bridge/dashboard work inside the Dograh provider tree. The July 31 plan (`.hermes/plans/2026-07-31_005938-vectis-operations-workstation-typescript7.md`) deliberately superseded that location and established this repository as the independently deployed Workstation. The four commits in the current repository then implemented that standalone control-plane foundation. Preserve the business vision from the first plan and the repository/ownership boundary from the second.

- Dograh executes voice workflows and campaigns.
- Twenty stores CRM people and call-outcome notes.
- Hermes acts as the owner/operator manager through a finite Workstation MCP interface.
- The Workstation owns consented imports, approval, cross-system correlation, durable operational state, delivery recovery, audit, health, and owner/operator views.

The required product path is:

```text
CSV
  -> server-side parse and consent classification
  -> staged import
  -> commit
  -> approval
  -> campaign draft and approval
  -> org-scoped Dograh CSV upload
  -> Dograh campaign start
  -> authenticated terminal callback
  -> provider-run projection + operation event + Twenty outbox row
  -> retrying worker
  -> Twenty person + idempotent call note
  -> owner/operator projections
```

That is the right foundation for Vectis. It prevents the dashboard from becoming a second call queue or a decorative reporting layer. The upgrade should **preserve that control-plane boundary** and add the business model required to answer:

> What did Vectis do for the business today, what needs attention, and what verified commercial outcome did it influence or recover?

## 2. Current architecture and implementation status

The active repository now contains only the intended application seams:

- `app/` and `components/`: Next.js App Router shell and Clerk/Convex providers;
- `convex/`: schema, functions, HTTP ingress, actions, and scheduled work;
- `docs/`: product contracts, ownership decisions, and implementation evidence.

The retired implementation is available only through Git history and is not an application branch, compatibility layer, data source, or test target. The current code is less complete than its task comments imply: Task 1 is substantially complete; Tasks 2, 3, and 5 are partial; Task 4 is absent; Tasks 6-9 are unaccepted drafts; Tasks 10-14 are not started. The detailed, file-grounded audit is maintained in `docs/implementation-status.md`.

## 3. Baseline verification result on 2026-08-30

- `npm test`: passed, but only 3 files/14 tests were discovered.
- `npm run typecheck`: failed on syntax errors in `convex/dograhCallback.ts` and `convex/workItems.ts`.
- `npm run lint`: failed with 38 errors and 5 warnings.
- Production build and browser E2E are unverified; browser E2E infrastructure is absent.
- The production build was not run during the audit because only 4.2 GiB was free and `AGENTS.MD` requires approval below 15 GiB.

### 3.1 Approved stack rule

The selected and exclusive product stack is **Next.js + Convex + Clerk**.

- Do not add a fallback application runtime, compatibility branch, dual-write path, alternate database driver, or retired build tooling.
- Use Git history only when old behavior is useful as a specification.
- Move one complete vertical slice at a time into `app/`, `components/`, `lib/`, and `convex/`.
- Accept a slice only after function tests, component tests, browser behavior, typecheck, lint, and production build are green.
- Vitest, `convex-test`, and Playwright are allowed test tooling; they do not define an alternative application architecture.

Official platform constraints that shape this plan:

- Convex mutations are the atomic state-transition seam; external network work belongs in actions.
- A client mutation should persist intent and atomically schedule an internal action instead of calling external actions directly.
- Convex actions and HTTP actions can have ambiguous external side effects and are not automatically retried; retain explicit idempotency, transitional claims, reconciliation state, and durable delivery records.
- Convex HTTP actions receive Dograh, Clerk, and Hermes callbacks at the `.convex.site` deployment URL.
- Convex queries and React subscriptions replace custom SSE for application state, while append-only operation events remain durable business/audit history.
- Clerk authenticates identity; Convex functions still enforce organization membership and role on every tenant-owned operation.
- Convex backups contain table documents and optional file storage, but not code, environment variables, or pending scheduled functions; the recovery runbook must cover all four separately.

## 4. Product boundary for the first robust MVP

### In scope

1. **Home / money screen** backed only by traceable commercial evidence.
2. **Customers** with canonical identity, current opportunity, next action, and unified timeline.
3. **Conversations** for voice first, with a channel-neutral shape for later messaging.
4. **Tasks/Tickets** with assignment, priority, SLA, lifecycle, sentiment, and linked customer context.
5. **Agents** showing business role, health, activity, outcomes, and safe campaign controls.
6. **Analytics** showing a date-scoped lead-to-revenue funnel and attribution explanation.
7. **Ask Vectis** as a persistent command surface with durable command state, proposed actions, approvals, idempotent execution, and grounded reports.
8. Production prerequisites: authentication, tenant context, audit, CI, browser E2E, provider reconciliation, backup/restore, and one consented live pilot.

### Explicitly out of scope for this MVP

- A generic CRM record editor or dozens of entity tabs.
- Replacing Twenty as CRM or Dograh as execution engine.
- A workflow-builder UI.
- WhatsApp, SMS, and email execution in the first release; preserve extension points but add channels only with live fixtures and verified ownership.
- Arbitrary owner prompts reaching shell, SQL, generic HTTP, unrestricted Dograh MCP, or unrestricted Twenty MCP.
- Fully autonomous mutation without approval.
- “Revenue saved” or “revenue generated” numbers inferred from calls alone.
- A data warehouse, microservices, Kafka, or a second queue.

## 5. Non-negotiable product rules

1. **Money must be evidenced.** Store amounts in minor units with ISO currency. Distinguish `estimated`, `confirmed`, and `collected` amounts. Show source, attribution rule, confidence, and last verification time.
2. **Recovered revenue is a subset of influenced revenue.** Do not add them together. “Recovered” requires evidence that the opportunity was previously missed, stale, abandoned, or overdue before Vectis intervened.
3. **Appointments are not revenue.** If payment data is unavailable, say “estimated pipeline value” or “booking value,” not “revenue generated.”
4. **Typed business facts beat provider JSON.** Normalize Dograh gathered context into a versioned outcome contract while retaining the raw sanitized provider payload for diagnosis.
5. **One writer per fact.** Workstation outbox owns post-call CRM writes. Dograh must not also receive unrestricted Twenty mutation tools.
6. **Owner and operator views are one application, not one cluttered navigation.** Keep six owner destinations; place imports, deliveries, integrations, audit, and live operations in an Admin/Operations drawer.
7. **Hermes manages; Dograh talks.** Hermes must never join customer calls or become the durable campaign queue.
8. **Every visible control must have a durable, audited, browser-verifiable effect.**

## 6. Canonical domain language

Create `CONTEXT.md` during Task 1 with these starting terms, then refine with the user before schema work:

- **Customer:** A person or organization receiving service. Identity survives multiple imports, channels, and opportunities.
- **Customer identity:** A normalized phone, email, or CRM identifier used to resolve one Customer inside one organization.
- **Opportunity:** One commercial pursuit for a Customer, with source, pipeline stage, expected value, and terminal outcome. A Customer may have several opportunities over time.
- **Source row:** Immutable provenance from an import. It is not the Customer.
- **Conversation:** A channel-specific thread or call grouping involving a Customer.
- **Interaction:** One inbound or outbound call/message/email event inside a Conversation.
- **Call run:** Workstation’s projection of one Dograh workflow run.
- **Business outcome:** A typed, evidenced result such as qualified, booking requested, booking confirmed, human handoff requested, quote requested, payment promised, or payment received.
- **Appointment:** A scheduled business commitment with its own requested/held/cancelled/no-show/completed lifecycle.
- **Work item:** Human-owned operational work. “Ticket” is a presentation subtype for customer issues/escalations.
- **Agent:** A business role backed by a configured Dograh workflow and integration binding; not an arbitrary LLM persona.
- **Attribution:** A deterministic, inspectable link between a Vectis interaction and a commercial outcome.
- **Manager command:** An owner instruction, its grounded interpretation, proposed actions, approvals, execution records, and final report.
- **Insight:** A reproducible observation from verified facts with an action that can be proposed; not free-form AI advice.

## 7. Target ownership and architecture

```text
Next.js App Router
  -> ClerkProvider
  -> ConvexProviderWithClerk
  -> authenticated Convex query/mutation
  -> membership/role guard
  -> atomic Convex mutation
      typed business documents
      append-only operation event
      audit record when actor mutates
      durable delivery/command row
      scheduled internal action when external work is required

Convex HTTP action <- authenticated Dograh/Clerk/Hermes webhook
Convex Node action <-> Dograh REST campaign adapter
Convex Node action <-> Twenty native MCP adapter
Convex cron/scheduler -> delivery retry, provider reconciliation, health freshness
Hermes manager -> finite Workstation MCP/HTTP interface -> Convex commands/proposals/reports

Next.js pages <- reactive Convex queries <- typed Convex state
Convex subscriptions replace custom SSE; bounded refresh/probes still expose stale dependencies
```

Keep one repository with explicit platform seams:

- `app/`: Next.js App Router pages, layouts, and the minimum route handlers that truly belong to the web host;
- `components/` and `lib/`: UI, providers, formatting, and generated-client helpers;
- `convex/`: schema, auth config, public queries/mutations, internal mutations/actions, HTTP routes, crons, and deep domain modules;
- `scripts/`: verified administrative tools only.

Prefer Convex HTTP actions for external webhooks so business ingress does not depend on the Next.js process. Do not implement the same business mutation in both a Next.js Route Handler and a Convex function. Next.js Route Handlers are reserved for framework-specific needs or a stateless MCP adapter proven incompatible with Convex HTTP actions.

## 8. Target navigation and page contracts

### Permanent shell

- Main navigation: **Home | Customers | Conversations | Tasks/Tickets | Agents | Analytics**.
- Permanent top command bar: **Ask Vectis…**.
- Secondary Admin/Operations menu: Imports, Campaigns detail, Deliveries, Integrations, Live Operations, Audit.
- URL-backed routing and deep links; browser refresh must retain the page, filters, and selected customer.

### Home

- “Vectis today” flow: calls handled -> reached -> qualified -> bookings -> confirmed/estimated commercial value.
- Month-to-date cards: confirmed influenced revenue, confirmed recovered revenue, bookings, calls handled, human attention.
- Every amount opens an attribution breakdown.
- Highest-value work and manager insights appear below the money screen.

### Customers

- Search, filters, source, owner, current stage, latest outcome, next action, and value.
- Customer detail: identity, AI summary with evidence links, open opportunity, timeline, open work, appointments, and commercial outcomes.

### Conversations

- Voice calls first: direction, agent, status, duration, summary, structured outcomes, recording/transcript, handoff.
- Later channels plug into the same interface only when their adapters and fixtures exist.

### Tasks/Tickets

- `open -> assigned -> investigating -> waiting_for_customer -> resolved`.
- Priority, assignee, team, SLA/due date, sentiment, AI summary, linked customer/conversation/outcome, and resolution.
- Resolving a work item may propose a Dograh follow-up but must not auto-call without policy/approval.

### Agents

- Agent role, online/degraded/offline/unknown, workflow binding, recent activity, resolution rate, qualification/bookings/collections outcomes, average duration, active campaigns.
- Draft/approve/start/pause/resume campaign controls with explicit effect and reconciliation state.

### Analytics

- Date-scoped funnel and conversion rates.
- Revenue attribution with definitions, source coverage, confidence, and drill-down.
- Campaign/agent/location/source comparisons only when dimensions are actually populated.

## 9. Implementation sequence

### Task 0: Preserve and classify the current working tree

**Objective:** Start from a known baseline without overwriting the existing 14 modified files or untracked agent documentation.

**Files:**
- Inspect only initially: all files reported by `git status`.
- Update after user decision: none automatically.

**Steps:**
1. Record `git status --short`, `git diff --stat`, and `git diff --name-status` in the implementation session.
2. Treat the selected Next.js + Convex + Clerk target as approved, but ask whether the current removal of Playwright and Dograh progress support is intentional before touching those dirty files.
3. Preserve unrelated edits exactly; do not reset, stash, commit, or format them as part of feature work.
4. Establish a file-level change manifest for each implementation slice.

**Gate:** The intended baseline is explicit and every pre-existing modified/untracked path is accounted for.

### Task 1: Freeze the product vocabulary, outcome contract, and money definitions

**Objective:** Prevent the UI and database from encoding ambiguous terms such as lead, customer, booking, influenced revenue, and recovered revenue.

**Files:**
- Create: `CONTEXT.md`.
- Create: `docs/product/robust-mvp.md`.
- Create: `docs/product/page-contracts.md`.
- Create: `docs/adr/0001-control-plane-ownership.md`.
- Create: `docs/adr/0002-commercial-attribution.md`.
- Create: `docs/adr/0003-nextjs-convex-clerk-platform.md`.
- Modify: `docs/architecture.md`.
- Modify: `docs/integration-contracts.md`.

**Steps:**
1. Write the glossary from Section 6 without implementation details.
2. Define the voice-first MVP lifecycle using concrete clinic/lead-recovery scenarios.
3. Define versioned business outcomes and required evidence for each.
4. Define amount statuses (`estimated`, `confirmed`, `collected`) and recovered/influenced attribution rules.
5. Define the six owner page contracts and the secondary operator surface.
6. Record the one-writer rule and Workstation/Dograh/Twenty/Hermes ownership as ADR-0001.
7. Record the commercial attribution trade-off and no-double-count rule as ADR-0002.
8. Record Next.js + Convex + Clerk, Convex HTTP ingress, action/mutation separation, and the single-platform rule as ADR-0003.

**Tests/validation:** Review each headline metric against a source field and a drill-down query. No metric may remain if its source/evidence is undefined.

**Gate:** The user can answer the open business decisions in Section 12, and every term used by schema/API/UI has one meaning.

### Task 2: Prove the Next.js + Convex + Clerk toolchain and create the application shell

**Objective:** Prove exact package/runtime compatibility before business implementation and establish a clean application shell on the approved stack.

**Files:**
- Modify: `package.json`.
- Modify: `vitest.config.ts`.
- Create: `next.config.ts`.
- Create: `convex.json`.
- Create: `convex/schema.ts`.
- Create: `convex/auth.config.ts`.
- Create: `convex/convex.config.ts`.
- Create: `convex/http.ts`.
- Create: `convex/crons.ts`.
- Create: `app/layout.tsx` and `app/page.tsx`.
- Create: `components/providers/ConvexClientProvider.tsx`.
- Create: the current Clerk route-protection file required by the pinned Next.js/Clerk versions (`proxy.ts` or `middleware.ts`, confirmed by the spike rather than guessed).
- Create: `convex/toolchain.test.ts`.
- Create: `.github/workflows/ci.yml`.
- Create: `playwright.config.ts` and `test/e2e/app-smoke.spec.ts` after resolving the current Playwright removal.
- Modify: `README.md`.

**Steps:**
1. Check disk thresholds from `AGENTS.MD` before changing dependencies; install once with npm only.
2. Pin a mutually compatible set of Next.js, React, Convex, Clerk, TypeScript, Vitest, `convex-test`, and Playwright versions. Use official Next.js/Convex/Clerk templates as references, not as code to copy blindly over the existing repository.
3. Prove `ClerkProvider` wraps the client `ConvexProviderWithClerk`, `convex/auth.config.ts` validates the Clerk issuer, and `useConvexAuth()` reaches authenticated state.
4. Prove one authenticated Convex query, one atomic mutation, one scheduled internal action, one HTTP action, one Node action using `fetch`, and one reactive client subscription.
5. Prove Convex code generation and TypeScript 7 work together before adding domain tables.
6. Configure Vitest projects for `convex-test` and jsdom component tests; add an optional real-backend/preview-deployment contract lane for HTTP actions and provider integration.
7. Add `npm run verify` for format-check, lint, Convex codegen/typecheck, unit/function tests, Next.js production build, and browser smoke tests.
8. Add CI using synthetic `convex-test` data for deterministic tests and a protected Convex preview/staging deployment only for integration tests that need a real HTTP endpoint.
9. Reject any application dependency, script, or compatibility path outside Next.js + Convex + Clerk.

**Gate:** A clean CI run is green; Clerk-authenticated Convex reads/mutations work; scheduled and HTTP functions are exercised; Next.js builds; and the browser smoke test proves the new shell renders.

### Task 3: Integrate Clerk identity with Convex-enforced tenancy and roles

**Objective:** Use Clerk-authenticated identity plus server-enforced Convex memberships; never derive tenant context from a client-provided organization ID or shared browser credential.

**Files:**
- Modify: `convex/schema.ts` with `users`, `organizations`, and `memberships` tables and tenant-scoped indexes.
- Create: `convex/lib/auth.ts` with `requireIdentity`, `requireMembership`, and `requireRole` helpers.
- Create: `convex/users.ts` and `convex/organizations.ts`.
- Create: `convex/http/clerkWebhook.ts` following Clerk/Convex’s official signed-webhook pattern.
- Modify: `convex/http.ts`.
- Modify: `convex/auth.config.ts`.
- Modify: `app/layout.tsx` and `components/providers/ConvexClientProvider.tsx`.
- Create: `app/sign-in/[[...sign-in]]/page.tsx` and `app/sign-up/[[...sign-up]]/page.tsx` if the pinned Clerk SDK still recommends these routes.
- Test: `convex/auth.test.ts` and `convex/organizations.test.ts`.
- Test: `test/e2e/auth-tenant-boundary.spec.ts`.

**Steps:**
1. Use Clerk only for identity/session management; mirror the minimum user profile in Convex through a verified Clerk webhook.
2. Keep application organization membership and roles authoritative in Convex so every query/mutation can enforce them consistently.
3. Resolve organization context from a validated membership, never from a naked client-provided organization ID.
4. Add `owner`, `operator`, and `staff` role checks to deep Convex helpers and call them from every public function.
5. Protect Next.js routes using the pinned Clerk SDK’s current convention; remember that Clerk middleware is not sufficient because Convex functions are independently callable.
6. Preserve separate signed/secret boundaries for Dograh callbacks and Hermes manager operations.
7. Add explicit unauthenticated, wrong-organization, inactive-membership, and wrong-role tests.

**Gate:** Unauthenticated requests are denied, cross-tenant ID substitution is denied, owner/operator permissions differ as documented, and no browser bundle contains provider or Workstation credentials.

### Task 4: Add Convex organization policy and integration bindings

**Objective:** Move tenant-specific business policy and provider identifiers into durable, non-secret state.

**Files:**
- Modify: `convex/schema.ts` with `organizationSettings` and `integrationBindings` tables and compound indexes beginning with `organizationId`.
- Create: `convex/organizationSettings.ts`.
- Create: `convex/integrationBindings.ts`.
- Create: `lib/contracts/organizationSettings.ts` only for framework-neutral UI/domain types not generated by Convex.
- Test: `convex/organizationSettings.test.ts`.

**Fields:** timezone, default currency, attribution window, business vertical, expected booking value policy, Dograh organization/workflow bindings, Twenty workspace mapping metadata, health freshness policy. Secrets live in deployment-specific Convex environment variables (declared in `convex/convex.config.ts` when supported by the pinned version) or the hosting secret store; tables retain only binding metadata and secret references.

**Gate:** Every date and amount query is organization-timezone/currency aware, and provider configuration is not inferred from global process state alone.

### Task 5: Introduce canonical Customers and Opportunities without deleting provenance

**Objective:** Stop treating each import row as the customer while preserving every source row and consent decision.

**Files:**
- Modify: `convex/schema.ts` with `sourceArtifacts`, `importBatches`, `importRows`, `customers`, `customerIdentities`, and `opportunities` plus tenant-first indexes.
- Create: `convex/imports.ts`.
- Create: `convex/customers.ts`.
- Create: `convex/opportunities.ts`.
- Create: `convex/lib/customerResolver.ts`.
- Create: `convex/backfills/customers.ts` only when an idempotent Convex schema backfill is required.
- Create: `lib/contracts/customer.ts` only for shared presentation types not generated by Convex.
- Test: `convex/customers.test.ts`, `convex/imports.test.ts`, and `convex/opportunities.test.ts` with `convex-test`.


**Steps:**
1. Normalize phone/email per organization and use tenant-composite uniqueness.
2. Resolve committed valid rows to one Customer without merging ambiguous identities silently.
3. Create an Opportunity per qualified source/business pursuit rather than per call.
4. Retain import batch/row provenance, original values, consent status, artifact checksum, and exclusion reason.
5. Add cross-batch duplicate detection and an explicit merge/review path.
6. If existing Convex documents require reshaping, backfill additively in a non-production Convex deployment first; verify per-table and per-tenant counts plus deterministic source IDs before switching reads.
7. Store original import artifacts in Convex file storage with checksum/metadata; keep uploaded data inaccessible without membership checks.

**Gate:** One customer can appear in multiple imports/campaigns without duplicate owner cards, while every call remains traceable to its exact source row and consent evidence.

### Task 6: Normalize calls, Conversations, and versioned Business Outcomes

**Objective:** Replace hair-specific/generic `gatheredContext` interpretation spread across UI/query code with one deep normalization module.

**Files:**
- Modify: `convex/schema.ts` with `conversations`, `interactions`, `providerRuns`, and `callOutcomes` tables and correlation/tenant indexes.
- Create: `lib/contracts/businessOutcome.ts`.
- Create: `convex/lib/normalizeDograhOutcome.ts`.
- Create: `convex/outcomes.ts`.
- Create: `convex/conversations.ts`.
- Create: `convex/customerTimeline.ts`.
- Create: `convex/http/dograhWebhook.ts` and register it in `convex/http.ts`.
- Test: `convex/dograhWebhook.test.ts` using real renderer string/empty shapes.
- Test: `convex/customerTimeline.test.ts`.

**Steps:**
1. Discover and record the exact live Dograh terminal payload for inbound and outbound runs.
2. Version the normalized outcome schema; support strings such as `"True"` deliberately at the adapter edge.
3. Authenticate and parse the Dograh HTTP request in an HTTP action, then call one internal mutation that atomically deduplicates, updates the run, projects typed outcomes, appends an operation event, and schedules downstream delivery.
4. Store sanitized raw context separately from typed outcomes.
5. Project call direction, start/end/duration, resolution, qualification, booking request, follow-up, handoff, sentiment, summary, recording, and transcript references.
6. Build the customer timeline as a reactive Convex query over authoritative typed tables; do not use an untyped timeline table as the source of truth.
7. Remove vertical-specific keys such as `hair_loss_concern` from generic page code; render configured/custom outcome fields through a safe schema.

**Gate:** A staff member opening a Customer sees all known calls and their evidence without asking the customer to repeat context.

### Task 7: Add appointments and human Work Items/Tickets

**Objective:** Turn “attention” from a passive derived warning into durable, assignable work.

**Files:**
- Modify: `convex/schema.ts` with `appointments`, `workItems`, and `deliveries` tables and tenant/status/due-date indexes.
- Create: `convex/workItems.ts`.
- Create: `convex/appointments.ts`.
- Create: `convex/deliveries.ts`.
- Create: `convex/actions/twenty.ts` with `"use node"` only if the pinned MCP SDK requires Node APIs.
- Create: `convex/lib/twentyAdapter.ts` with narrow task/appointment operations.
- Create: `lib/contracts/workItem.ts` and `lib/contracts/appointment.ts`.
- Test: `convex/workItems.test.ts`, `convex/appointments.test.ts`, and `convex/deliveries.test.ts`.
- Test: `test/contract/twenty-convex-action.test.ts` against a fake Streamable HTTP MCP server.

**Steps:**
1. Implement ticket lifecycle, assignment, priority, due/SLA timestamps, sentiment, AI summary, and resolution.
2. Create work items idempotently from typed handoff/dispute/follow-up outcomes.
3. Keep booking requested and booking confirmed separate; only confirm after the authoritative calendar/CRM write succeeds.
4. In one mutation, reserve the tenant-scoped delivery idempotency key, append the event, and schedule the internal Twenty action.
5. Make the action call Twenty, then call a completion/failure mutation; retry only from persisted delivery state with bounded backoff and reconciliation for ambiguous external results.
6. Add provider read-back verification, audited human mutations, and a follow-up proposal path.

**Gate:** A payment dispute or callback request becomes one tenant-scoped work item with owner, status, evidence, and safe resolution/follow-up behavior.

### Task 8: Reconcile Dograh instead of trusting callbacks as the entire campaign truth

**Objective:** Keep local campaign/run projections fresh and terminal even when callbacks are delayed, missing, duplicated, or out of order.

**Files:**
- Modify: `convex/schema.ts` with `campaigns`, `campaignMembers`, provider state, sync/reconciliation timestamps, and provider IDs.
- Create: `convex/campaigns.ts` for authenticated reads and atomic draft/approve/start/pause/resume claims.
- Create: `convex/actions/dograh.ts` for external campaign mutations and provider reads.
- Create: `convex/lib/dograhAdapter.ts` with campaign detail, progress, runs, and report operations.
- Create: `convex/reconciliation.ts`.
- Modify: `convex/crons.ts` to schedule a bounded reconciliation sweep away from the top of the hour.
- Test: `convex/campaigns.test.ts` and `convex/reconciliation.test.ts`.
- Test: `test/contract/dograh-convex-action.test.ts` against a fake Dograh server.

**Steps:**
1. Preserve separate business status, provider execution state, and call disposition.
2. Have the cron invoke one internal mutation that selects a bounded indexed batch and schedules individual internal actions; do not collect an unbounded table inside a cron.
3. Poll only active/reconciliation-required campaigns with timeout cancellation and backoff.
4. Upsert provider progress/runs idempotently; callbacks remain the fast path.
5. Mark a 100%-processed campaign terminal only after provider lifecycle confirms terminal/stopped state.
6. Surface reconciliation-required work rather than retrying ambiguous mutations.
7. Add a read-back canary proving the live Dograh organization/workflow/telephony prerequisites before a start.

**Gate:** Campaign counts match Dograh, stale running campaigns are visible, and an ambiguous mutation cannot produce duplicate campaigns/calls.

### Task 9: Build commercial outcomes and attribution before designing the money screen

**Objective:** Create a defensible source for revenue/pipeline metrics.

**Files:**
- Modify: `convex/schema.ts` with `commercialOutcomes`, `attributions`, and optional `dailyMetrics` tables plus tenant/time/status indexes.
- Create: `convex/lib/money.ts` and `convex/lib/attribution.ts` as pure deterministic modules.
- Create: `convex/commercialOutcomes.ts`.
- Create: `convex/analytics.ts` with paginated drill-down queries.
- Extend: `convex/lib/twentyAdapter.ts` and `convex/actions/twenty.ts` with bounded opportunity/payment reads supported by the live schema.
- Create: `lib/contracts/analytics.ts`.
- Test: `convex/attribution.test.ts`, `convex/homeSummary.test.ts`, and `convex/revenueFunnel.test.ts`.

**Steps:**
1. Store money as integer minor units plus currency.
2. Ingest booking, quote, sale, promise, and payment facts with source type/external ID/evidence timestamp.
3. Enforce tenant-scoped idempotency for external facts.
4. Link facts to opportunities and Vectis interactions through deterministic rules.
5. Make recovered attribution require a prior missed/stale/no-show/overdue state.
6. Compute day/month windows in organization timezone.
7. Return amount breakdowns and data-coverage warnings with every aggregate.
8. Start in shadow mode: compare projections with Twenty/business records before showing the headline.

**Gate:** Every rupee on Home drills down to named opportunities and source evidence; the sum of the drill-down equals the card exactly.

### Task 10: Rebuild the shell around the six owner areas

**Objective:** Deliver the requested information architecture without discarding the working operator views.

**Files:**
- Create: `app/(dashboard)/layout.tsx`.
- Create: `components/shell/AppShell.tsx` and `components/manager/AskVectisBar.tsx`.
- Create: `app/(dashboard)/home/page.tsx`.
- Create: `app/(dashboard)/customers/page.tsx` and `app/(dashboard)/customers/[customerId]/page.tsx`.
- Create: `app/(dashboard)/conversations/page.tsx` and `app/(dashboard)/conversations/[conversationId]/page.tsx`.
- Create: `app/(dashboard)/tasks/page.tsx`.
- Create: `app/(dashboard)/agents/page.tsx`.
- Create: `app/(dashboard)/analytics/page.tsx`.
- Create: `app/(dashboard)/operations/*` for Imports, Campaigns detail, Deliveries, Integrations, Live Operations, and Audit.
- Create focused client components under `components/` that subscribe with generated Convex APIs; keep Server Components for static/layout work rather than forcing all pages client-side.
- Create: `app/globals.css` and focused CSS modules or the selected pinned styling system; migrate existing styles only as each page moves.
- Test: domain page/component tests under `test/unit/web/`.
- Test: `test/e2e/owner-navigation.spec.ts` and `test/e2e/mobile-navigation.spec.ts`.

**Steps:**
1. Use App Router file-system routes, layouts, `loading.tsx`, `error.tsx`, and `not-found.tsx` where appropriate.
2. Keep the Ask Vectis bar visible on all six owner pages.
3. Move technical IDs/provider jargon behind detail disclosure or Admin/Operations.
4. Add Convex indexed pagination, search, reactive filters, and accessible keyboard/focus behavior.
5. Implement one page contract at a time and require browser evidence before accepting the route.
6. Verify 390x844 mobile and desktop with no horizontal document overflow.

**Gate:** An owner can answer today’s value, who needs attention, what every agent is doing, and why a metric exists without visiting an operator page.

### Task 11: Add the Agent registry and business-facing command center

**Objective:** Turn Dograh workflow IDs into understandable business agents and expose safe controls.

**Files:**
- Modify: `convex/schema.ts` with `agents` and agent/workflow binding fields.
- Create: `convex/agents.ts` and `convex/agentPerformance.ts`.
- Modify: `convex/campaigns.ts` to bind campaigns to Agents.
- Modify: `convex/managerTools.ts` with agent-aware reads/mutations.
- Create: `lib/contracts/agent.ts`.
- Test: `convex/agents.test.ts` and `convex/agentPerformance.test.ts`.
- Test: `test/unit/web/agents-page.test.tsx`.

**Steps:**
1. Map a configured Dograh workflow/version to a business role such as Reception or Lead Recovery.
2. Derive online/healthy/unknown from workflow binding, provider health, and recent activity—not a hardcoded badge.
3. Calculate resolution, qualification, booking, collection, and duration metrics from typed outcomes.
4. Add browser draft/approval/start/pause/resume controls using the same invocation path as MCP.
5. Show provider IDs only in operator details.

**Gate:** The Agents page reports real work and each control produces one audited, idempotent state transition.

### Task 12: Implement Ask Vectis as durable commands, proposals, and approvals

**Objective:** Let an owner manage the system conversationally without giving free-form prompts unrestricted capabilities.

**Files:**
- Modify: `convex/schema.ts` with `managerCommands`, `managerProposals`, and mutation audit fields.
- Create: `convex/managerCommands.ts` for authenticated submit/approve/cancel mutations and reactive reads.
- Create: `convex/managerTools.ts` for the finite shared invocation path.
- Create: `convex/actions/hermes.ts` and `convex/http/hermesCallback.ts`.
- Modify: `convex/http.ts`.
- Create: `app/api/mcp/route.ts` only if the compatibility spike proves stateless MCP cannot be hosted safely as a Convex HTTP action; it must remain a thin authenticated adapter over Convex manager functions.
- Create: `lib/contracts/managerCommand.ts`.
- Create: `components/manager/ManagerCommandPanel.tsx`.
- Test: `convex/managerCommands.test.ts`.
- Test: `test/contract/hermes-command-runner.test.ts`.
- Test: `test/e2e/ask-vectis.spec.ts`.

**Lifecycle:**

```text
submitted -> interpreting -> proposed -> awaiting_approval
          -> executing -> completed
          -> failed / cancelled / reconciliation_required
```

**Steps:**
1. In one authenticated Convex mutation, persist owner text, actor, tenant, timestamps, sanitized structured interpretation request, and correlation ID, then atomically schedule the internal Hermes action.
2. Perform a compatibility spike between two adapters:
   - preferred decoupled adapter: signed Hermes webhook containing only command ID/correlation; Hermes reads context and reports results through finite Workstation MCP tools;
   - bounded local fallback: spawn `hermes -z --query-file` without a shell and require final structured result plus Workstation tool calls.
3. Bind the Vectis Hermes profile to Workstation MCP for business mutations; do not let the command session bypass policy through direct unrestricted provider tools.
4. Separate read-only answers from proposed mutations.
5. Require approval for campaigns, calls, customer messages, ticket resolution follow-ups, and bulk actions.
6. Execute approved actions through one Convex `invokeManagerTool` implementation, preserving tenant scope, actor, idempotency, audit, and fail-closed provider guards.
7. Expose command progress through reactive Convex queries; do not add a parallel SSE channel.
8. Add timeout, cancellation, replay, duplicate submission, and agent-crash recovery behavior.

**Gate:** “Call everyone who missed yesterday and try to reschedule” first resolves an exact eligible audience, displays exclusions and proposed action, requires approval, creates one Dograh campaign, and later reports counts grounded in correlated call/appointment facts.

### Task 13: Add deterministic Manager Insights, then AI explanation

**Objective:** Make Vectis identify operational opportunities without hallucinating patterns.

**Files:**
- Modify: `convex/schema.ts` with `insights` and evidence fields.
- Create: `convex/insightRules/afterHoursMissedLeads.ts`.
- Create: `convex/insightRules/repeatedQuestion.ts`.
- Create: `convex/insightRules/campaignComparison.ts`.
- Create: `convex/insights.ts`.
- Modify: `convex/crons.ts` to schedule bounded insight refresh.
- Create: `components/insights/InsightCard.tsx`.
- Test: `convex/insightRules/*.test.ts` and `convex/insights.test.ts`.

**Steps:**
1. Compute reproducible rules over a minimum sample size and fixed time window.
2. Persist evidence rows, query version, confidence, generated/expiry timestamps, and proposed action.
3. Let Hermes explain a deterministic finding, but never invent the finding or denominator.
4. Implement `Fix it`, `Create campaign`, and `Ask Vectis` as command proposals—not immediate side effects.
5. Suppress stale/low-sample insights and show why.

**Gate:** Every insight opens its source cohort and the displayed numerator/denominator recompute exactly.

### Task 14: Production hardening and one-recipient counted pilot

**Objective:** Prove the whole Workstation path, not just provider connectivity.

**Files:**
- Create: `docs/runbooks/deployment.md`.
- Create: `docs/runbooks/backup-restore.md`.
- Create: `docs/runbooks/provider-reconciliation.md`.
- Create: `docs/runbooks/live-pilot.md`.
- Create deployment manifests only after the target environment is chosen.
- Extend health/metrics/logging modules and security tests.

**Steps:**
1. Define separate deployment gates for Convex functions and the Next.js host, including dev/preview/staging/prod Convex deployments and Clerk dev/prod instances.
2. Add structured redacted logs, request/correlation IDs, scheduled-action/delivery status, stale work, Convex usage limits, and alert thresholds.
3. Add retention rules for PII, recordings/transcript links, raw provider context, audit, and events.
4. Test Convex export/backup and restore into a separate non-production deployment; verify tenant counts/hashes and separately restore source code, environment variables, Clerk configuration, and required pending work because Convex backups do not include all of them.
5. Verify Clerk route protection, Convex function authorization, rate limits, webhook replay limits, secure headers, and secret rotation.
6. Deploy schema/functions backward-compatibly before the Next.js client that needs them; add new required fields as optional, backfill, verify, then tighten validation in a later deploy.
7. Run the full isolation/recovery matrix in Section 11.
8. Execute one explicitly authorized, consented recipient through import -> commit -> approval -> campaign -> call -> callback -> customer timeline -> work/appointment -> Twenty read-back -> Home/Analytics attribution.
9. Verify exactly one Twenty outcome and person link through live read-back, not only a delivery `succeeded` flag.
10. Record gaps honestly; do not mark MVP production-ready until the UI evidence and provider facts agree.

**Gate:** The counted pilot is visible end-to-end, survives Next.js redeploy and Convex function redeploy, restores correctly in a non-production drill, and leaves no ambiguous external mutation or unowned human work.

## 10. Suggested release slices

### Release A — Trustworthy application foundation

Tasks 0-4. Outcome: reproducible CI, authenticated tenant context, durable organization policy, and agreed commercial definitions.

### Release B — Customer operations

Tasks 5-8. Outcome: canonical customer memory, voice conversations, typed outcomes, durable human work/appointments, and reconciled Dograh campaigns.

### Release C — Money screen

Tasks 9-10. Outcome: six-area owner application with a defensible Home and Analytics funnel.

### Release D — AI operations manager

Tasks 11-13. Outcome: business-facing agents, Ask Vectis proposals/approvals/results, and grounded insights.

### Release E — Robust MVP pilot

Task 14. Outcome: verified deployment/recovery and one real counted end-to-end pilot.

Do not begin a release by implementing all schema and then all UI horizontally. Within each task, deliver one vertical slice:

```text
failing Convex function test -> schema/index + query/mutation/action contract
-> failing component test -> page -> browser effect -> full verification
```

## 11. Required verification matrix

Before calling the robust MVP complete, prove:

- Authenticated owner/operator roles and cross-tenant rejection on every new resource.
- Every public Convex query, mutation, and action authenticates and authorizes independently of Next.js route protection.
- Every tenant-owned index begins with or otherwise constrains `organizationId`; representative inconsistent-link fixtures cannot leak across tenants.
- Scheduled functions are internal, receive explicit tenant/actor context because auth is not propagated by the scheduler, and revalidate referenced records before acting.
- No owner list query relies on an unbounded `.collect()` over a growing table; pagination and bounded indexed batches are tested.
- Next.js redeploy/Convex redeploy persistence and tested Convex backup/export restore.
- Duplicate and out-of-order Dograh callbacks.
- Missing callback recovered by provider reconciliation.
- Ambiguous Dograh create/start/pause/resume state remains fail-closed.
- Two scheduled delivery actions cannot claim/deliver the same row.
- External Convex actions persist a claim before the network call and never assume Convex will automatically retry ambiguous side effects.
- Twenty timeout retries safely; final person/note/task/appointment is read back exactly once.
- Import approval and consent block campaign eligibility.
- Cross-batch customer identity ambiguity does not silently merge people.
- Appointment requested is not presented as confirmed.
- Revenue card sum equals its drill-down and respects currency/timezone.
- Recovered revenue is not double-counted on top of influenced revenue.
- Manager duplicate command/idempotency replay executes once.
- Manager prompt cannot call unknown/unrestricted tools.
- Every mutation records actor, tenant, target, result, and correlation.
- Convex subscriptions reconnect to current state; durable operation events remain queryable; scheduled freshness checks expose stale integrations.
- All six owner destinations and Admin destinations work in desktop and 390x844 mobile browser.
- Every visible button has an asserted user-level effect.
- `npm run verify` and production build pass in CI.
- Live pilot preserves source consent, Workstation IDs, Dograh IDs, customer/opportunity, Twenty records, and money evidence.

## 12. Business decisions required before Task 9

These do not block foundation/customer work, but they block honest money metrics:

1. **Initial vertical:** recommended default is Vectis lead recovery for clinics/medspas because the current examples and outcome fields fit that workflow.
2. **Revenue source of truth:** recommended order is collected payment -> closed-won Twenty opportunity -> confirmed appointment multiplied by configured expected value. Display these as separate certainty levels.
3. **Booking authority:** identify whether Twenty, a calendar provider, or the business’s scheduling system confirms appointments.
4. **Recovery definition:** define when a lead becomes missed/stale/no-show/overdue and the attribution window after Vectis activity.
5. **Customer value:** decide whether expected value is organization-wide, service-specific, or opportunity-specific.
6. **First agent set:** recommended MVP is Reception and Lead Recovery. Add Collections only when payment-promise and payment-received facts exist.
7. **Deployment model:** choose single-client managed deployment versus shared multi-tenant SaaS. Clerk is selected for authentication and Convex remains tenant-safe in either case.
8. **Human routing:** define teams, assignees, SLA, and escalation rules for the first client.

## 13. Highest-risk trade-offs

- **Revenue credibility is the product.** A visually impressive Home page backed by guessed values would damage trust more than showing no revenue yet.
- **Ask Vectis is not a chat widget.** Its value comes from durable intent, exact audience selection, approval, idempotent execution, and counted reporting.
- **A Customer is not an import row.** This distinction is foundational for every timeline, ticket, booking, and revenue view.
- **Current provider JSON is vertical-specific.** Normalize it once behind a deep outcome interface instead of teaching every page about each Dograh workflow field.
- **Current browser auth is not production auth.** Do not expose the shared Workstation key in frontend code as a shortcut.
- **There is one application platform.** Implement vertical slices only on Next.js + Convex + Clerk; do not introduce compatibility runtimes, alternate persistence, or dual-write paths.
- **Convex does not remove distributed-systems failure modes.** Mutations are atomic, but Dograh, Twenty, and Hermes calls happen in actions. Persist claims and idempotency before calls, read back outcomes, and reconcile ambiguous timeouts.
- **Clerk route protection is not database authorization.** A signed-in user can still call public Convex functions directly; every function must enforce membership and role through one deep auth helper.
- **Convex schema evolution is deploy-time application evolution, not SQL migration sequencing.** Add optional fields/indexes first, run idempotent backfills, switch readers, then tighten validators; keep old web clients compatible during the rollout window.
- **Do not make all channels look implemented.** Ship voice-first Conversations and add WhatsApp later through a real adapter and verified event fixtures.

## 14. Authoritative implementation references

Check these official documents again during Task 2 because package APIs can change:

- Convex Next.js Quickstart: `https://docs.convex.dev/quickstart/nextjs`
- Convex + Clerk: `https://docs.convex.dev/auth/clerk`
- Convex Actions: `https://docs.convex.dev/functions/actions`
- Convex HTTP Actions: `https://docs.convex.dev/functions/http-actions`
- Convex Scheduled Functions and Crons: `https://docs.convex.dev/scheduling/scheduled-functions` and `https://docs.convex.dev/scheduling/cron-jobs`
- Convex Testing: `https://docs.convex.dev/testing/overview` and `https://docs.convex.dev/testing/convex-test`
- Convex Backup & Restore: `https://docs.convex.dev/database/backup-restore`
- Next.js App Router Route Handlers: `https://nextjs.org/docs/app/getting-started/route-handlers`

The official docs win over this plan on setup syntax. Product ownership, idempotency, tenant isolation, and acceptance gates in this plan remain mandatory even when framework syntax changes.

## 15. Definition of done

The first robust MVP is done when a business owner can open Home and immediately see a truthful, drillable answer to what Vectis did today; inspect every affected customer and conversation; assign and resolve human work; understand each agent’s activity; inspect a lead-to-commercial-outcome funnel; ask Vectis for work; approve the exact proposed action; and later receive a counted result whose calls, bookings, CRM records, and money evidence reconcile with Dograh, Twenty, and the authoritative Convex deployment.
