# ADR-0003: Next.js + Convex + Clerk platform

Status: accepted

## Context

The product needs production authentication, reactive UI state, managed durability, and one unambiguous application architecture. Maintaining a compatibility runtime or dual persistence path would increase risk without preserving production data that the project needs.

## Decision

Use one repository and one runtime architecture: Next.js App Router (`app/`, `components/`, `lib/`), Convex (schema, functions, HTTP actions, scheduler, file storage), and Clerk (identity). Rules:

- The retired implementation remains only in Git history as a behavior reference; it is not built, run, imported, or maintained.
- Do not add compatibility branches, dual writes, migration adapters, database drivers, server runtimes, or browser build tooling for the retired stack.
- Move one complete vertical slice at a time and acceptance-test it against the product contracts.
- Convex mutations are the atomic state-transition seam; external network work lives in actions, scheduled via internal mutations after persisting intent.
- Convex HTTP actions receive Dograh/Clerk/Hermes webhooks at `.convex.site`; Next.js Route Handlers are reserved for framework-specific needs only.
- Convex subscriptions replace custom SSE; operation events remain append-only durable audit history.
- Clerk authenticates identity; every Convex function still enforces organization membership and role. Clerk route protection is not database authorization.
- Next.js, Convex, and Clerk are the only application platform. Vitest and Playwright are test tooling, not alternative application runtimes.

## Consequences

- Convex does not remove distributed-systems failure modes: persist claims and idempotency before external calls, read back outcomes, reconcile ambiguous timeouts.
- Schema evolution is deploy-time: add optional fields/indexes, backfill, switch readers, then tighten validators.
