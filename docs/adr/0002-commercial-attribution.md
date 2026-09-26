# ADR-0002: Commercial attribution and no double counting

Status: accepted

## Context

The money screen is the product's credibility. Guessed revenue damages trust more than showing none. "Recovered" and "influenced" value overlap and would double count if summed.

## Decision

1. Money is stored as integer minor units + ISO currency, with statuses `estimated`, `confirmed`, `collected`.
2. Every displayed amount links to a deterministic attribution rule, its source records, confidence, and last verification time. No attribution rule, no metric.
3. Recovered revenue is a strict subset of influenced revenue and is displayed as a breakdown, never added to it.
4. Attribution requires: (a) an external fact with source type/external ID/evidence timestamp, ingested idempotently per tenant; (b) a deterministic link to an opportunity and a Vectis interaction; (c) for "recovered," prior evidence of missed/stale/abandoned/overdue state.
5. Aggregates compute in the organization's timezone and return data-coverage warnings with every value.

## Consequences

- Until payment facts exist, the Home screen shows "estimated pipeline value"/"booking value," not "revenue generated."
- Metrics start in shadow mode against Twenty/business records before becoming headline numbers.
