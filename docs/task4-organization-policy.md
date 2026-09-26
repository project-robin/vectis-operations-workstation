# Task 4 organization policy and integration bindings

Audit date: 2026-08-31

## Decisions

- One `organizationSettings` document is provisioned in the same Convex transaction as a newly mirrored active organization. A duplicate row is an integrity error; it is never silently selected.
- Defaults are `UTC`, `INR`, a 30-day `interaction_to_outcome` attribution window, `opportunity` expected booking value, commercial metrics `shadow`, Twenty read-back authority for bookings/payments, recovery enabled for missed/stale/no-show/overdue evidence, and health freshness warning/critical thresholds of 15/60 minutes. An active owner may safely initialize a legacy organization with the same defaults.
- Attribution windows are positive integer hours or days and cannot exceed 720 hours. A window measures the elapsed time from the Vectis interaction to the commercial outcome.
- Money is a non-negative safe integer of minor units plus an uppercase ISO 4217 currency. Currency minor digits come from `Intl.NumberFormat` (for example, USD/INR use two and JPY uses zero).
- Expected booking value is explicitly one of `none`, `org_wide`, `service`, or `opportunity`. `org_wide` requires one amount/currency; `service` requires unique service amounts/currencies; the other modes carry no amount.
- Integration bindings are unique by `(organizationId, bindingKey)` and have `dograh`, `twenty`, or `hermes` provider type plus `active`/`inactive` status. Dograh bindings require organization/workflow identifiers; Twenty bindings require a workspace identifier.
- Binding documents contain metadata, mappings, health/freshness information, and deployment secret **reference names** only. Secret values, tokens, passwords, API keys, and credential-shaped metadata are rejected and are not persisted.
- Browser-callable reads derive tenancy through `requireMembership`; owner-only mutations derive actor and tenant through `requireRole(ctx, "manage_members")`. Internal resolver calls require an explicit organization ID and revalidate the organization and active binding without propagated Clerk auth.

## Public function inventory

| Function | Kind | Access |
|---|---|---|
| `organizationSettings.getCurrent` | query | active staff/operator/owner |
| `organizationSettings.initializeDefaults` | mutation | active owner |
| `organizationSettings.update` | mutation | active owner |
| `organizationSettings.publishCommercialMetrics` | mutation | active owner; latest shadow comparison must pass all readiness checks |
| `integrationBindings.list` | query | active staff/operator/owner |
| `integrationBindings.get` | query | active staff/operator/owner; tenant rechecked |
| `integrationBindings.upsert` | mutation | active owner; create or update with explicit binding ID |
| `integrationBindings.update` | mutation | active owner; tenant rechecked |
| `integrationBindings.remove` | mutation | active owner; tenant rechecked |

`integrationBindings.resolve` and `resolveByKey` are internal query seams for future Convex actions. They return the binding metadata and secret reference names, not secret values.

## Verification boundary

`convex/organizationSettings.test.ts` is deterministic `convex-test` coverage for defaults, validation boundaries, role and lifecycle denial, cross-tenant substitution, duplicate behavior, secret rejection, internal resolution, timezone date boundaries, and currency/minor-unit formatting. The existing protected Clerk/Convex lane remains credential-gated; no live provider credentials are committed or inferred.
