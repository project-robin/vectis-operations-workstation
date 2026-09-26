# Task 3 security matrix and public-function inventory

Audit date: 2026-08-30

Task 3 is deterministic-test complete but **protected-verification-blocked** until a disposable live Clerk + Convex fixture is configured. `convex-test` proves authorization and lifecycle behavior; it is not proof that a deployed Clerk issuer, webhook secret, Convex URL, or browser session is wired correctly.

## Role matrix

The active Clerk `org_id` claim selects the Convex organization. The Convex membership row supplies the role. `org_role` and any client-supplied organization/resource ID never grant access.

| Permission | staff | operator | owner | Public functions covered |
|---|---:|---:|---:|---|
| `read` | yes | yes | yes | `users.getCurrent`, `organizations.getCurrent`, `toolchain.probeCount` |
| `operate` | no | yes | yes | `toolchain.recordProbe`, `toolchain.removeProbe`, `toolchain.scheduleEcho` |
| `manage_members` | no | no | yes | `organizations.addMember` |
| `approve` | no | no | yes | `imports.approveBatch` (Task 5-owned API; included so the owner-only approval boundary is explicit) |

Task 3 itself has no approval mutation. The Task 5 approval API is listed and tested for its role boundary, but Task 3 does not claim Task 5 business-completion behavior.

## Public Convex inventory

This is the complete public `query`/`mutation`/`action` inventory in the active Convex source as of this audit. Internal functions and HTTP route handlers are separate boundaries and are not callable through `api`.

| Function | Kind | Owner | Authorization expectation |
|---|---|---|---|
| `users.getCurrent` | query | Task 3 | authenticated active mirrored user |
| `organizations.getCurrent` | query | Task 3 | authenticated active mirrored member |
| `organizations.addMember` | mutation | Task 3 | active owner; target is an existing active mirrored Clerk user |
| `organizationSettings.getCurrent` | query | Task 4 | active member; current tenant only |
| `organizationSettings.initializeDefaults` | mutation | Task 4 | active owner; current tenant only |
| `organizationSettings.update` | mutation | Task 4 | active owner; current tenant only; audited |
| `organizationSettings.publishCommercialMetrics` | mutation | Task 9 | active owner; readiness-gated; audited |
| `integrationBindings.list` | query | Task 4 | active member; current tenant only |
| `integrationBindings.get` | query | Task 4 | active member; binding must belong to current tenant |
| `integrationBindings.upsert` | mutation | Task 4 | active owner; current tenant only; audited |
| `integrationBindings.update` | mutation | Task 4 | active owner; binding must belong to current tenant; audited |
| `integrationBindings.remove` | mutation | Task 4 | active owner; binding must belong to current tenant; audited |
| `toolchain.probeCount` | query | Task 2 | authenticated active member; current tenant only |
| `toolchain.recordProbe` | mutation | Task 2 | active operator or owner; current tenant only |
| `toolchain.removeProbe` | mutation | Task 2 | active operator or owner; target row must belong to current tenant |
| `toolchain.scheduleEcho` | mutation | Task 2 | active operator or owner; current tenant only |
| `customers.createCustomer` | mutation | Task 5 | active operator or owner; identities normalized and tenant-scoped |
| `customers.listCustomers` | query | Task 5 | active member; tenant-first pagination/search |
| `customers.getCustomer` | query | Task 5 | active member; linked customer and bounded provenance must belong to current tenant |
| `customers.listIdentityReviews` | query | Task 5 | active member; open reviews in current tenant only |
| `customers.resolveIdentityReview` | mutation | Task 5 | active owner; candidate and source row must belong to current tenant |
| `customers.mergeCustomers` | mutation | Task 5 | active owner; both canonical customers must belong to current tenant; audited |
| `imports.generateArtifactUploadUrl` | mutation | Task 5 | active operator or owner |
| `imports.finalizeArtifact` | mutation | Task 5 | active operator or owner; storage metadata, checksum, MIME, size, and tenant ownership validated |
| `imports.getArtifact` | query | Task 5 | active member; current tenant only |
| `imports.getArtifactUrl` | query | Task 5 | active member; current tenant only; ready artifact only |
| `imports.stageImport` | mutation | Task 5 | active operator or owner; artifact/batch tenant linkage validated |
| `imports.commitBatch` | mutation | Task 5 | active operator or owner; bounded, idempotent staged batch |
| `imports.approveBatch` | mutation | Task 5 | active owner; committed batch only |
| `imports.listImportBatches` | query | Task 5 | active member; current tenant only |
| `imports.listEligibleRows` | query | Task 5 | active member; approved + valid + consented rows only; bounded pagination |
| `opportunities.createOpportunity` | mutation | Task 5 | active operator or owner; source pursuit/customer/row links cross-validated; owner override for excluded rows |
| `opportunities.listOpportunities` | query | Task 5 | active member; tenant-first bounded pagination |
| `opportunities.getOpportunity` | query | Task 5 | active member; current tenant only |
| `opportunities.updateOpportunity` | mutation | Task 5 | active operator or owner; tenant/role/value/currency/terminal-state validation |
| `commercialOutcomes.ingest` | mutation | Task 9 | active operator or owner; tenant links, integer money, source idempotency, authoritative booking/payment gates |
| `commercialOutcomes.get` / `commercialOutcomes.list` / `commercialOutcomes.getAttribution` | query | Task 9 | active member; tenant-first bounded evidence and attribution reads |
| `commercialOutcomes.recordShadowComparison` | mutation | Task 9 | active owner; bounded comparison snapshot; audited |
| `analytics.getHomeSummary` / `analytics.getAnalytics` / `analytics.getCommercialDrilldown` | query | Task 9 | active member; timezone-scoped, currency-separated, bounded/paginated shadow-aware reads |
| `conversations.listCustomerConversations` | query | Task 6 | active member; Task 6-owned |
| `conversations.listRecentConversations` | query | Task 6 | active member; Task 6-owned |
| `customerTimeline.getCustomerTimeline` | query | Task 6 | active member; linked customer must belong to current tenant; Task 6-owned |
| `appointments.requestAppointment` | mutation | Task 7 | active operator or owner; requested-only, linked records tenant-validated |
| `appointments.recordAppointmentStatus` | mutation | Task 7 | active operator or owner; confirmed is reserved for authoritative read-back |
| `appointments.listCustomerAppointments` | query | Task 7 | active member; bounded tenant-first page |
| `workItems.createWorkItem` | mutation | Task 7 | active operator or owner; optional assignee must be active same-tenant member |
| `workItems.assignWorkItem` | mutation | Task 7 | active operator or owner; active same-tenant assignee |
| `workItems.setWorkItemStatus` | mutation | Task 7 | owner/operator or assigned staff; legal transition and resolution validation |
| `workItems.listWorkItems` / `workItems.getWorkItem` | query | Task 7 | active member; bounded tenant-first reads |
| `deliveries.reserveDeliveryIntent` / `deliveries.reconcileDelivery` | mutation | Task 7 | active operator or owner; idempotent reservation / explicit reconciliation |
| `deliveries.listDeliveries` / `deliveries.getDelivery` | query | Task 7 | active member; bounded tenant-first reads |
| `campaigns.listCampaigns` / `campaigns.getCampaign` | query | Task 8 | active member; bounded tenant-first reads |
| `campaigns.createCampaignDraft` / `campaigns.startCampaign` / `campaigns.pauseCampaign` / `campaigns.resumeCampaign` | mutation | Task 8 | active operator or owner; approved batch/binding/transition/idempotency checks |
| `campaigns.approveCampaign` / `campaigns.reconcileCampaign` | mutation | Task 8 | owner approval; operator/owner explicit human reconciliation |

There are no public Convex actions. `nodeActions.fetchText`, `toolchain.echoAction`, `providerRuns.*`, `dograhCallback.ingest`, `deliveries.reserve`, `deliveries.claim`, `deliveries.finish`, `deliveries.reconcile`, `deliveries.retryDue`, `deliveries.sweepDue`, `actions.twenty.deliver`, `actions.twenty.readOpportunities`, `actions.twenty.readPayments`, `commercialOutcomes.ingestInternal`, and `http.clerkWebhook.processEvent` are internal-only; the documented `deliveries.reserveDeliveryIntent`, read, and reconciliation functions are authenticated public mutations/queries. `/ping` is a public HTTP health route; `/clerk/webhook` is a signed POST ingress and `/dograh/webhook` is a dedicated-secret POST ingress, neither is a public Convex function.

## Lifecycle and replay invariants

- A missing identity, unknown user, inactive/deleted user, unknown/inactive organization, inactive/deleted membership, or duplicate authoritative row fails closed.
- Organization selection requires the active Clerk `org_id` claim plus one matching active Convex membership for the authenticated subject.
- Clerk roles map fail-closed: `org:admin` → `owner`, `org:operator` → `operator`, `org:staff` and `org:member` → `staff`; unknown keys are rejected.
- Webhook event IDs are idempotent. A conflicting payload or event type reusing an existing event ID fails closed. The ledger stores only event metadata and a payload digest, never the raw event. Ledger metadata is retained for the documented seven-day default (longer than the five-minute replay window), then removed by the indexed 100-row cleanup batch with scheduled continuation and hourly cron.
- User, organization, and membership updates are monotonic by verified resource `updated_at`/`created_at` when present, otherwise the Svix timestamp. Equal timestamps use a bounded event version containing the event ID; `lifecycleVersion` is optional for additive/backfill-safe schema rollout. Deletes retain tombstones; only a newer `*.created` event can recreate a tombstone.
- Membership events validate Clerk membership ID, organization, and user as one integrity-preserving tuple. Delete events can resolve by durable membership ID after a parent delete.
- Tenant-owned resource IDs are revalidated against the authoritative organization on every public mutation/query that accepts one.

## Webhook test contract

Synthetic tests use `standardwebhooks` to produce supported Svix signatures. Coverage includes missing secret, missing signature, invalid signature, valid signature, duplicate replay, wrong method, empty body, invalid timestamp, declared oversize, and streamed/chunked oversize. No real signing secret is stored.

## Protected live contract

The live lane must set all Task 3 fixture variables in `.env.local`/CI secrets and use a disposable tenant. It must provide explicit owner/operator/staff session states, expected role labels (`owner`, `operator`, and `staff` respectively), the primary organization ID, and a separate cross-tenant session/organization. The test creates one probe in the disposable tenant, attempts a cross-tenant removal, and removes the probe in cleanup. If credentials or any fixture variable are absent, the lane reports Task 3 as blocked and does not claim live proof; partial fixture configuration is an error.
