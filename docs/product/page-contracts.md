# Page contracts

Permanent shell: main nav **Home | Customers | Conversations | Tasks/Tickets | Agents | Analytics**; persistent top **Ask Vectis…** bar; secondary Admin/Operations menu (Imports, Campaigns detail, Deliveries, Integrations, Live Operations, Audit). URL-backed routing; refresh retains page, filters, and selection.

## Home (money screen)
- "Vectis today" flow: calls handled → reached → qualified → bookings → confirmed/estimated commercial value.
- Month-to-date cards: confirmed influenced revenue, confirmed recovered revenue (breakdown, never summed), bookings, calls handled, human attention.
- Every amount opens an attribution breakdown. Highest-value work and insights below.

## Customers
- List: search, filters, source, owner, current stage, latest outcome, next action, value.
- Detail: identity, AI summary with evidence links, open opportunity, unified timeline, open work, appointments, commercial outcomes.

## Conversations
- Voice first: direction, agent, status, duration, summary, structured outcomes, recording/transcript, handoff. Detail per conversation.

## Tasks/Tickets
- Lifecycle: `open → assigned → investigating → waiting_for_customer → resolved`.
- Priority, assignee, team, SLA/due date, sentiment, AI summary, linked customer/conversation/outcome, resolution. Resolution may propose a Dograh follow-up; never auto-calls without approval.

## Agents
- Role, health (derived, not hardcoded), workflow binding, recent activity, resolution rate, qualification/bookings/collections outcomes, average duration, active campaigns.
- Draft/approve/start/pause/resume controls with explicit effect and reconciliation state. Provider IDs in operator details only.

## Analytics
- Date-scoped lead-to-revenue funnel and conversion rates; revenue attribution with definitions, coverage, confidence, drill-down; comparisons only when dimensions are populated.

## Rule
Every visible control has a durable, audited, browser-verifiable effect.
