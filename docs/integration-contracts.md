# Integration contracts

> Platform note (ADR-0003): Dograh and Hermes webhooks terminate at Convex HTTP actions on the `.convex.site` deployment. Next.js Route Handlers must not duplicate these business mutations.

## Dograh campaign API

Frozen from the read-only Dograh source at `main` / `ff6a711`. Live behavior was later checked against the local Vectis Dograh organization.

- Base path: `/api/v1`
- Authentication: `X-API-Key`
- No client retries for mutation requests.

| Operation | Method and path |
|---|---|
| Request CSV upload | `POST /s3/presigned-upload-url` |
| Upload CSV | `PUT {upload_url}` with `Content-Type: text/csv` |
| Create campaign | `POST /campaign/create` |
| Get campaign | `GET /campaign/{id}` |
| Start | `POST /campaign/{id}/start` |
| Pause | `POST /campaign/{id}/pause` |
| Resume | `POST /campaign/{id}/resume` |
| Progress | `GET /campaign/{id}/progress` |
| Runs | `GET /campaign/{id}/runs` |
| Report | `GET /campaign/{id}/report` |

Create payload:

```json
{
  "name": "Approved campaign name",
  "workflow_id": 123,
  "source_type": "csv",
  "source_id": "campaigns/{dograh_org_id}/{generated_file}.csv"
}
```

The uploaded CSV carries stable Workstation correlation columns such as `workstation_lead_id` and `workstation_provider_run_id`. Dograh owns queueing, scheduling, retries, and redial behavior; the Workstation does not duplicate them.

## Dograh callback

The active callback implementation is `POST /dograh/webhook` (`convex/http/dograhWebhook.ts`). Dograh Webhook nodes execute asynchronously after a workflow run finishes and render every `{{...}}` placeholder as a string; a value missing from the renderer is an empty string. The official provider source documents `workflow_run_id` as an integer, while the checked-in Vectis workflow templates emit the same value under `run_id` as a string. Both forms are accepted at this adapter edge.

Recorded/source-backed terminal shapes used by `convex/task6.test.ts`:

- inbound Vectis template: `run_id`, string-rendered `workflow_id`, `workflow_name`, `from_number`, `phone_number`, `outcome`, `call_summary`, nested `extracted_variables` with boolean values rendered as `"True"`/`"False"`, `recording`/`transcript` as empty strings when no artifact exists, plus nested `initial_context` and `gathered_context` JSON strings;
- outbound/provider-doc shape: integer `workflow_run_id`, `workflow_id`, `call_time`, object `initial_context`/`gathered_context`, and `recording_url`/`transcript_url` as `null` when absent.

The provider source's renderer converts `None` to `""`, dictionaries/lists to JSON strings, booleans to Python strings (`True`/`False`), and missing paths to `""`. The adapter deliberately accepts those renderer variants, but only `workstation_provider_run_id` from the pre-registered run's initial context selects a tenant. Provider `organization_id`, campaign, workflow, and customer values are never authorization inputs.

Required correlation fields after rendering:

```json
{
  "run_id": "13501",
  "initial_context": { "workstation_provider_run_id": "opaque-workstation-id" },
  "gathered_context": "{\"extracted_variables\":{\"appointment_requested\":\"True\"}}"
}
```

The callback secret is `X-Dograh-Webhook-Secret`; absent configuration, wrong secrets, malformed/oversized bodies, unsafe artifact references, missing correlation, and provider/workstation collisions fail closed. Terminal callbacks project exactly once into `providerRuns`, `conversations`, `interactions`, and versioned `callOutcomes`, append one `operationEvents` record, and atomically reserve one tenant-idempotent pending `deliveries` intent while scheduling the internal Twenty action. Requested booking remains requested; provider call context cannot confirm an appointment.


## Live Dograh-to-Twenty ownership check

The Vectis Dograh organization currently has one published workflow and no active reusable tools or reusable credentials. The published workflow still references the retired bridge at `host.docker.internal:3002/dograh/pre-call` and `/dograh/webhook`; no process is listening on that port. Historical source files reference an unpublished Twenty MCP tool, but it is not present in the live organization.

Until a bounded in-call lookup credential is deliberately added to Dograh, the supported write path is:

1. Dograh owns call execution.
2. The Workstation receives the authenticated terminal callback.
3. A durable outbox writes the result to Twenty exactly once.

Do not attach unrestricted Twenty `execute_tool` access to a voice workflow while the Workstation outbox owns post-call writes; doing so would permit duplicate CRM mutations. The verified Twenty MCP endpoint is `https://vectisin.twenty.com/mcp`.

## Hermes manager MCP

- Endpoint: `POST /mcp` using Streamable HTTP MCP.
- Authentication: environment-backed `X-Manager-Key`.
- Six read-only tools expose overview, recent calls, attention, lead trace, integration health, and active campaigns.
- Six mutation tools expose campaign draft/approval/start/pause/resume and dead-letter retry.
- Mutations require an idempotency key and create a tenant-scoped Hermes audit reservation before execution. Completed results are replayed without executing twice.
- No arbitrary SQL, shell, generic HTTP, or provider-tool forwarding is exposed.

## Canonical customer/import/opportunity contract (Task 5)

- `sourceArtifacts` stores only Convex storage metadata, a sanitized original filename, MIME type, bounded byte size, lowercase SHA-256 checksum, uploader, timestamp, and lifecycle status. The checksum is deduplicated within an organization; storage IDs and artifact URLs are never exposed across memberships.
- `importRows` is the immutable source-of-truth provenance table. Raw values, consent, consent evidence timestamp, mapping version, validation, and the staging exclusion reason are write-once. Customer links, review state, and eligibility are controlled resolution fields. `sourceRows` remains only as a compatibility mirror for the unfinished campaign draft.
- A row is campaign-eligible only when its batch is approved, its validation is valid, its consent is `consented`, and it has no unresolved identity conflict. Unknown/unconsented rows remain traceable but are never returned by `imports.listEligibleRows`.
- Phone and email identities are normalized per organization and stored in `customerIdentities`. A phone/email collision across canonical customers creates an open `identityReviewItems` record; it is never resolved by precedence. Owners explicitly resolve reviews or merge canonical customers, with `operationEvents` and `customerMergeRecords` evidence.
- `opportunities` are tenant-scoped and idempotent per `(organizationId, sourceType, sourcePursuitId)`. Expected values are non-negative integer minor units with the organization currency. Terminal `won`/`lost` states require a terminal outcome and cannot be reopened. Excluded source rows require an explicit owner override.
- Task 5 adds no retained-data migration: the evolution is additive and the legacy `sourceRows` mirror remains for compatibility until the later campaign draft is rebuilt.

## API exposure and tenant boundary

- Browser operations use Clerk identity, then enforce Convex organization membership and role inside every public function.
- Convex HTTP actions expose only documented ingress routes. `/ping` may be public; the Clerk lifecycle endpoint is `/clerk/webhook` and requires Clerk Standard Webhooks/Svix verification. Dograh and Hermes ingress retain separate dedicated authentication.
- Provider secrets remain in deployment environment variables and never enter browser bundles or tenant documents.

## Organization policy and binding contract (Task 4)

- `organizationSettings` is one tenant-scoped document containing the validated IANA timezone, uppercase ISO 4217 default currency, bounded `interaction_to_outcome` attribution window, business vertical, expected booking value policy, shadow/published commercial mode, booking/payment authority policies, recovery definitions/window, health freshness thresholds, timestamps, and actor references.
- New organization lifecycle provisioning writes UTC, INR, a 30-day attribution window, opportunity-derived booking value, and 15/60-minute health freshness defaults in the same Convex transaction. An active owner may idempotently initialize an older organization.
- `integrationBindings` is unique per `(organizationId, bindingKey)` and stores only `dograh`/`twenty`/`hermes` provider metadata, active/inactive status, provider IDs/mappings, health metadata, and deployment secret reference names. It never stores credential values.
- Public reads are active-member scoped; writes are owner-only and append audited operation events. Internal actions resolve with an explicit organization ID and revalidate both organization and active binding without relying on propagated Clerk auth.

### Clerk lifecycle and roles

Convex is authoritative for application tenancy. The active Clerk `org_id` claim is only a selector; authorization requires a matching active Convex organization and active membership for the authenticated Clerk subject. Missing or duplicate legacy rows fail closed.

The application role hierarchy is `owner > operator > staff`. Clerk role keys are mapped fail-closed: `org:admin` → `owner`, `org:operator` → `operator`, and `org:staff` or generic `org:member` → `staff`. Any other Clerk role key is rejected; claims such as `org_role` never grant owner access.

| Role | Read tenant data | Operate imports/probes | Approve imports | Manage memberships |
|---|---:|---:|---:|---:|
| staff | yes | no | no | no |
| operator | yes | yes | no | no |
| owner | yes | yes | yes | yes |

The signed Clerk webhook mirrors the minimum user, organization, and organization-membership profile/lifecycle data into Convex. It is the only identity lifecycle writer; public identity ensure/update/bootstrap mutations do not exist. Public membership administration may only resolve an already mirrored active Clerk user and never creates identity rows. User, organization, and membership events carry a verified bounded Svix timestamp and stale events are ignored. Deletes deactivate records and retain history; only a newer `*.created` event may recreate a tombstone. Event IDs are idempotent in the bounded metadata-only `webhookEvents` ledger; a conflicting payload or event type for an existing ID fails closed, with only a SHA-256 payload digest retained. The complete function inventory and role matrix are in [docs/task3-security-matrix.md](task3-security-matrix.md).
- Every tenant-owned query, mutation, scheduled function, and linked-record lookup constrains and revalidates `organizationId`.

## Task 7 durable work and delivery contract

- Work item statuses are `open -> assigned -> investigating -> waiting_for_customer -> resolved` with only documented legal transitions. Resolution requires a human note. A resolved item may retain a follow-up proposal, but proposals never invoke a call or provider action.
- Appointment `requested` and `confirmed` are separate facts. Confirmation is written only after an authoritative Twenty/calendar mutation returns an external ID and an exact read-back containing that ID.
- Delivery reservation is atomic per `(organizationId, idempotencyKey)`. Claims carry a lease token and expiry; stale claims recover only after expiry, and completion requires the matching token. Determinate failures use bounded backoff until `maxAttempts`; timeouts, 5xx, malformed/read-back failures become `reconciliation_required` and are never blindly retried.
- Twenty actions resolve an active binding by explicit organization and binding key, then read the API key only through a binding environment reference. Binding metadata is non-secret; credentials are never stored in Convex documents or logged.

## Task 9 commercial evidence and analytics contract

`commercialOutcomes` is an append-only, tenant-scoped fact ledger keyed by `(organizationId, sourceType, sourceExternalId)`. Facts carry kind, amount in integer minor units plus ISO currency, status (`estimated`, `confirmed`, `collected`), source/evidence timestamps and references, confidence, coverage, and shadow/publication state. Currency mismatches are accepted only as segregated facts and never summed into the organization currency. Booking requests remain estimated; confirmed bookings and collected payments require the configured authoritative source and read-back evidence. Calls and appointments alone are not revenue.

Attribution is a pure deterministic selection persisted in `attributions`: latest preceding same-customer/compatible-opportunity interaction inside the configured organization window, stable ID tie-break, explicit rule/version/window/confidence/explanation, or `unattributed` when none exists. `recovered` is a subset of `influenced` and requires explicit `opportunityStateEvidence` for an allowed missed/stale/no-show/overdue state before the selected interaction. Replays are source-idempotent and do not create a second attribution.

Home and Analytics queries are active-member, date-range, organization-timezone, bounded/paginated reads. They return separate status totals, currency-separated values, zero-safe funnel denominators, definitions, last verification, coverage warnings, shadow/published state, and drilldown queries. `commercialComparisons` stores bounded shadow snapshots; only the owner publication mutation may switch mode after verified source mapping, complete currency coverage, fresh evidence, zero discrepancies, and complete policy. Twenty opportunity/payment reads use only mapped read-only `searchRecords` calls and retain `unknown` coverage until the live schema is verified.

## Task 8 campaign execution contract

`campaigns.businessStatus` is the workstation business lifecycle (`draft`, `approved`, `starting`, `running`, `pausing`, `paused`, `resuming`, `failed`, `completed`, `reconciliation_required`). `providerExecutionState` and each member's `callDisposition` are independent provider/call projections; the legacy `status` fields are additive compatibility aliases. Campaign creation accepts one approved import batch and reads only eligible Task 5 `importRows` (valid, consented, resolved customer). It creates members and pending `providerRuns` with deterministic `workstationRunId` correlations in one transaction.

Public campaign reads are active-member scoped and bounded. Draft/start/pause/resume require an operator or owner; approval is owner-only. Start, pause, and resume first claim `starting`/`pausing`/`resuming` with a lease and idempotency key, then schedule one internal action. A mutation attempt is never retried automatically. Timeout, transport, 5xx, or malformed mutation outcomes become `reconciliation_required`; a definite provider rejection becomes `failed`. Provider campaign IDs are persisted immediately after definite create, and every definite mutation is followed by a `GET /campaign/{id}` read-back.

The Dograh action resolves the active binding by explicit workstation organization, uses its `dograhOrganizationId`/`dograhWorkflowId`, and reads only the named API-key environment variable. Secrets never enter documents, audit payloads, CSVs, logs, or browser code. The pre-start canary reads the bound workflow; telephony is returned as `unknown` when no supported generic prerequisite endpoint is available. CSV upload is HTTPS-only except loopback fake-server tests, is bounded to 500 rows/10 MiB, and contains only `workstation_provider_run_id`, `source_row_id`, `name`, and `phone`.

Callbacks update pre-registered member dispositions idempotently. Reconciliation polls detail, progress, runs, and report with bounded work and upserts workstation projections without allowing terminal state regression. `processedRows == totalRows` is not terminal until the provider lifecycle is terminal/stopped/completed. Every five minutes a tenant-first bounded cron schedules individual reconciliation actions; operators can explicitly reconcile, retry after human resolution, or fail a campaign, and each choice is audited.
