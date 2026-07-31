# Integration contracts

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

Dograh Webhook nodes support a credential-backed Authorization header or custom templated headers, but no native payload signature was found. The Workstation contract uses a constant-time checked `X-Dograh-Webhook-Secret` header.

Required payload fields:

```json
{
  "workflow_run_id": "provider idempotency key",
  "workstation_provider_run_id": "Workstation correlation UUID",
  "campaign_id": 123,
  "workflow_id": 456,
  "state": "completed",
  "gathered_context": {},
  "recording_url": null,
  "transcript_url": null
}
```

`workflow_run_id` deduplicates retries. `workstation_provider_run_id` selects an existing tenant-scoped projection; organization IDs supplied by the callback are never trusted for authorization.

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

## API exposure and tenant boundary

- The API defaults to loopback-only binding (`127.0.0.1`).
- A non-loopback `HOST` is rejected at startup unless `WORKSTATION_API_KEY` is configured.
- When configured, ordinary Workstation REST routes require `X-Workstation-Key`.
- `/api/health/live` remains public for process probes; Dograh webhooks and Hermes manager/MCP routes retain their own dedicated authentication.
- The Workstation API key is an owner/operator credential with access across configured organizations; every data query and mutation still scopes by `organizationId`.

## Fail-closed delivery and campaign rules

- Outbox idempotency is unique per `(organization_id, idempotency_key)`; a key reused by another tenant creates an independent delivery and cannot disclose or suppress the first tenant's row.
- Dograh start, pause, and resume operations atomically claim a transitional local state before contacting the provider, so concurrent requests cannot both execute the provider mutation.
- Once a Dograh campaign create, start, pause, or resume request is attempted, an ambiguous provider error never restores the prior retryable state.
- Ambiguous provider mutations mark the campaign `failed` and append `campaign.reconciliation_required`. Operators must reconcile Dograh state before any later recovery action, preventing automatic duplicate campaigns or calls.
