# Robust MVP product definition

## Goal

An owner opens Home and sees a truthful, drillable answer to: what did Vectis do for the business today, what needs attention, and what verified commercial outcome did it influence or recover.

## Voice-first MVP lifecycle (clinic/lead-recovery scenario)

1. A consented lead list is imported, consent-classified, committed, and approved.
2. An approved campaign drives a Dograh agent (Reception or Lead Recovery) to call leads.
3. Each terminal call normalizes into typed **business outcomes** (qualified, booking requested, human handoff requested, quote requested, payment promised) with sanitized raw context retained for diagnosis.
4. Outcomes create: customer timeline entries, appointments (requested ≠ confirmed), work items for humans, and Twenty records via the outbox.
5. External facts (booking confirmed, payment received) flow back with source evidence and become commercial outcomes with attribution.
6. Home/Analytics aggregate only evidenced facts; every amount drills down to named opportunities.

## Business outcome contract (versioned `v1`)

| Outcome | Required evidence |
|---|---|
| qualified | gathered context satisfies the configured qualification fields |
| booking_requested | explicit request statement in gathered context |
| booking_confirmed | authoritative calendar/CRM write succeeded (never from call text alone) |
| human_handoff_requested | explicit handoff/dissatisfaction signal |
| quote_requested | explicit request statement |
| payment_promised | explicit promise statement with amount when stated |
| payment_received | external payment fact with source type/external ID |

Strings like `"True"` are normalized deliberately at the adapter edge. Raw provider context is stored separately from typed outcomes.

## Amount statuses

`estimated` (configured expected value × pipeline) → `confirmed` (closed-won opportunity or confirmed appointment) → `collected` (payment fact). Never summed across statuses.

## Commercial evidence and attribution contract

Commercial facts are immutable, tenant-scoped records keyed idempotently by `(organizationId, sourceType, sourceExternalId)`. Money is integer `amountMinor` plus ISO currency. `estimated`, `confirmed`, and `collected` totals are separate; appointments and calls are not revenue. A confirmed booking requires configured authoritative read-back, and a collected payment requires configured payment-source evidence.

Attribution is deterministic: choose the latest preceding Vectis interaction for the same customer (and compatible opportunity) inside the organization window, breaking timestamp ties by stable ID. Missing interaction means unattributed/manual. `recovered` is never additive: it is true only when persisted missed/stale/no-show/overdue evidence predates the selected interaction and fits the configured recovery window.

Home and Analytics return definitions, currency-separated totals, coverage warnings, last verification, shadow/published state, and bounded drilldown queries. Commercial metrics default to `shadow`; an owner-only publication toggle requires a passing comparison snapshot with verified source mappings, complete currency coverage, fresh evidence, zero discrepancies, and complete policy.

## Open business decisions blocking money metrics

Initial vertical (recommended: clinic/medspa lead recovery), revenue source of truth order, booking authority, recovery definition/window, customer expected-value scope, first agent set (Reception + Lead Recovery), deployment model, human routing/SLA.
