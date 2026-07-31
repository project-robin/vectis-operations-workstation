import { z } from "zod";

const leadBaseSchema = z.object({
  id: z.number().int().positive(),
  displayName: z.string(),
  phone: z.string(),
  classification: z.string(),
});
const leadSchema = leadBaseSchema.extend({
  providerState: z.string().nullable(),
});
const runSchema = z.object({
  id: z.uuid(),
  state: z.string(),
  providerWorkflowRunId: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});
const deliverySchema = z.object({
  id: z.uuid(),
  type: z.string(),
  status: z.enum(["pending", "processing", "succeeded", "dead"]),
  attempts: z.number().int().nonnegative(),
  providerRunId: z.string().nullable().optional(),
  nextAttemptAt: z.iso.datetime(),
  lastError: z.string().nullable(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
const traceSchema = z.object({
  lead: leadBaseSchema.extend({
    email: z.string().nullable(),
    consentStatus: z.string().nullable(),
  }),
  runs: z.array(runSchema),
  deliveries: z.array(deliverySchema.omit({ providerRunId: true })),
  timeline: z.array(
    z.object({
      id: z.string(),
      component: z.string(),
      title: z.string(),
      status: z.string(),
      occurredAt: z.iso.datetime(),
    }),
  ),
});
const attentionSchema = z.array(
  z.object({
    id: z.string(),
    kind: z.enum(["delivery_dead", "call_failed"]),
    title: z.string(),
    summary: z.string(),
    leadId: z.number().int().positive().nullable(),
    retryable: z.boolean(),
    occurredAt: z.iso.datetime().nullable(),
  }),
);

export type LeadSummary = z.infer<typeof leadSchema>;
export type LeadTrace = z.infer<typeof traceSchema>;
export type Delivery = z.infer<typeof deliverySchema>;
export type AttentionItem = z.infer<typeof attentionSchema>[number];

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url);
  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }
  return response.json();
}

export async function getLeads(organizationId: string, fetcher: typeof fetch = fetch) {
  return leadSchema
    .array()
    .parse(
      await getJson(`/api/leads?organizationId=${encodeURIComponent(organizationId)}`, fetcher),
    );
}

export async function getLeadTrace(
  organizationId: string,
  leadId: number,
  fetcher: typeof fetch = fetch,
) {
  return traceSchema.parse(
    await getJson(
      `/api/leads/${leadId}/trace?organizationId=${encodeURIComponent(organizationId)}`,
      fetcher,
    ),
  );
}

export async function getDeliveries(organizationId: string, fetcher: typeof fetch = fetch) {
  return deliverySchema
    .array()
    .parse(
      await getJson(
        `/api/deliveries?organizationId=${encodeURIComponent(organizationId)}`,
        fetcher,
      ),
    );
}

export async function getAttentionItems(organizationId: string, fetcher: typeof fetch = fetch) {
  return attentionSchema.parse(
    await getJson(`/api/attention?organizationId=${encodeURIComponent(organizationId)}`, fetcher),
  );
}
