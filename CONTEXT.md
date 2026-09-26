# Vectis domain language

One term, one meaning. Schema, API, and UI must use these words exactly.

- **Customer** — A person or organization receiving service. Identity survives multiple imports, channels, and opportunities. Not an import row.
- **Customer identity** — A normalized phone, email, or CRM identifier used to resolve one Customer inside one organization.
- **Opportunity** — One commercial pursuit for a Customer, with source, pipeline stage, expected value, and terminal outcome. A Customer may have several over time.
- **Source row** — Immutable provenance from an import. It is not the Customer.
- **Conversation** — A channel-specific thread or call grouping involving a Customer.
- **Interaction** — One inbound or outbound call/message/email event inside a Conversation.
- **Call run** — Workstation's projection of one Dograh workflow run.
- **Business outcome** — A typed, evidenced result: qualified, booking requested, booking confirmed, human handoff requested, quote requested, payment promised, payment received.
- **Appointment** — A scheduled business commitment with its own requested/held/cancelled/no-show/completed lifecycle. A requested appointment is never presented as confirmed.
- **Work item** — Human-owned operational work. "Ticket" is a presentation subtype for customer issues/escalations.
- **Agent** — A business role backed by a configured Dograh workflow and integration binding; not an arbitrary LLM persona.
- **Attribution** — A deterministic, inspectable link between a Vectis interaction and a commercial outcome.
- **Manager command** — An owner instruction, its grounded interpretation, proposed actions, approvals, execution records, and final report.
- **Insight** — A reproducible observation from verified facts with a proposed action; not free-form AI advice.

## Money

- Amounts are stored as integer minor units plus ISO currency code.
- Amount statuses: `estimated` < `confirmed` < `collected`. Displayed separately, never summed across statuses.
- **Influenced revenue** — commercial value with a deterministic attribution link to Vectis activity.
- **Recovered revenue** — a subset of influenced revenue requiring prior evidence that the opportunity was missed, stale, abandoned, or overdue before Vectis intervened. Never added on top of influenced revenue.
- Appointments are not revenue. Without payment data, say "estimated pipeline value" or "booking value."
