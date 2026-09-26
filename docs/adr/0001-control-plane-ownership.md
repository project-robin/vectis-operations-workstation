# ADR-0001: Control-plane ownership (one writer per fact)

Status: accepted

## Context

Dograh executes calls, Twenty stores CRM data, Hermes manages, and the Workstation correlates and controls. Post-call CRM writes could plausibly happen from Dograh tools or the Workstation outbox.

## Decision

The Workstation outbox is the single writer of post-call CRM facts. Dograh never receives unrestricted Twenty mutation tools. Hermes never joins customer calls and never becomes a durable campaign queue. Dograh owns call execution (queueing, scheduling, retries, redials); the Workstation owns consented imports, approval, correlation, durable operational state, delivery recovery, audit, and health.

## Consequences

- Any in-call Twenty write would violate this ADR; bounded lookups are allowed only with a deliberate credential decision.
- Duplicate CRM mutations are structurally prevented, not just discouraged.
- The Workstation stays a narrow control plane; it does not become a second call queue.
