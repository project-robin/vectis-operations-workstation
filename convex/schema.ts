import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

const consent = v.union(v.literal("consented"), v.literal("unconsented"), v.literal("unknown"));

export const leadSource = v.union(v.literal("csv"), v.literal("twenty"), v.literal("manual"));
// "called" means at least one call reached a terminal result; "remaining" in the UI is new + failed.
export const leadStatus = v.union(
  v.literal("new"),
  v.literal("queued"),
  v.literal("called"),
  v.literal("failed"),
);
export const batchStatus = v.union(
  v.literal("creating"),
  v.literal("running"),
  v.literal("paused"),
  v.literal("completed"),
  v.literal("failed"),
);
export const callStatus = v.union(
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("no_answer"),
  v.literal("failed"),
);
export const crmStatus = v.union(
  v.literal("pending"),
  v.literal("synced"),
  v.literal("failed"),
  v.literal("skipped"),
);

export default defineSchema({
  // ponytail: spike table; removed when the first real page stops needing it
  toolchainProbes: defineTable({
    organizationId: v.id("organizations"),
    label: v.string(),
    createdAt: v.number(),
  })
    .index("by_organization_created_at", ["organizationId", "createdAt"])
    .index("by_organization_label", ["organizationId", "label"]),

  scheduledEchoes: defineTable({
    organizationId: v.id("organizations"),
    payload: v.string(),
    status: v.union(v.literal("pending"), v.literal("completed"), v.literal("failed")),
    createdAt: v.number(),
    finishedAt: v.optional(v.number()),
  })
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_status_finished_at", ["organizationId", "status", "finishedAt"])
    .index("by_organization_finished_at", ["organizationId", "finishedAt"]),

  // Durable cursors keep bounded maintenance sweeps from restarting at the first tenant.
  maintenanceState: defineTable({
    key: v.string(),
    cursor: v.union(v.string(), v.null()),
  }).index("by_key", ["key"]),

  // Task 3: Clerk identity mirrored into Convex; Clerk claims alone never authorize (ADR-0003)
  users: defineTable({
    clerkId: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    // Optional lifecycle fields keep older synthetic/imported rows readable.
    active: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    lifecycleAt: v.optional(v.number()),
    lifecycleVersion: v.optional(v.string()),
  }).index("by_clerk_id", ["clerkId"]),

  organizations: defineTable({
    clerkOrgId: v.string(),
    name: v.string(),
    slug: v.optional(v.string()),
    active: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    lifecycleAt: v.optional(v.number()),
    lifecycleVersion: v.optional(v.string()),
  })
    .index("by_clerk_org_id", ["clerkOrgId"])
    .index("by_created_at", ["createdAt"]),

  memberships: defineTable({
    userId: v.id("users"),
    organizationId: v.id("organizations"),
    role: v.union(v.literal("owner"), v.literal("operator"), v.literal("staff")),
    active: v.optional(v.boolean()),
    clerkMembershipId: v.optional(v.string()),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    lifecycleAt: v.optional(v.number()),
    lifecycleVersion: v.optional(v.string()),
  })
    // Every tenant-owned membership lookup starts with organizationId.
    .index("by_organization_user", ["organizationId", "userId"])
    .index("by_organization_role", ["organizationId", "role"])
    .index("by_user", ["userId"])
    .index("by_clerk_membership_id", ["clerkMembershipId"]),

  // Task 4: one durable, backfill-safe policy document per organization.
  organizationSettings: defineTable({
    organizationId: v.id("organizations"),
    timezone: v.string(),
    defaultCurrency: v.string(),
    attributionWindow: v.object({
      value: v.number(),
      unit: v.union(v.literal("hours"), v.literal("days")),
      semantics: v.literal("interaction_to_outcome"),
    }),
    businessVertical: v.optional(v.string()),
    expectedBookingValuePolicy: v.object({
      mode: v.union(
        v.literal("none"),
        v.literal("org_wide"),
        v.literal("service"),
        v.literal("opportunity"),
      ),
      amountMinor: v.optional(v.number()),
      currency: v.optional(v.string()),
      serviceValues: v.optional(
        v.array(v.object({ service: v.string(), amountMinor: v.number(), currency: v.string() })),
      ),
    }),
    commercialMetricsMode: v.optional(v.union(v.literal("shadow"), v.literal("published"))),
    bookingAuthorityPolicy: v.optional(
      v.object({ sourceType: v.string(), requireReadback: v.boolean() }),
    ),
    paymentAuthorityPolicy: v.optional(
      v.object({ sourceTypes: v.array(v.string()), requireReadback: v.boolean() }),
    ),
    recoveryPolicy: v.optional(
      v.object({
        enabled: v.boolean(),
        window: v.object({
          value: v.number(),
          unit: v.union(v.literal("hours"), v.literal("days")),
        }),
        priorStateTypes: v.array(
          v.union(
            v.literal("missed"),
            v.literal("stale"),
            v.literal("no_show"),
            v.literal("overdue"),
          ),
        ),
      }),
    ),
    healthFreshnessPolicy: v.object({
      warningAfterMinutes: v.number(),
      criticalAfterMinutes: v.number(),
    }),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_updated_at", ["organizationId", "updatedAt"]),

  // Only provider metadata and deployment-secret reference names belong here.
  integrationBindings: defineTable({
    organizationId: v.id("organizations"),
    bindingKey: v.string(),
    provider: v.union(v.literal("dograh"), v.literal("twenty"), v.literal("hermes")),
    status: v.union(v.literal("active"), v.literal("inactive")),
    dograhOrganizationId: v.optional(v.string()),
    dograhWorkflowId: v.optional(v.string()),
    twentyWorkspaceId: v.optional(v.string()),
    twentyObjectMappings: v.optional(
      v.array(v.object({ workstationType: v.string(), twentyObject: v.string() })),
    ),
    metadata: v.optional(v.array(v.object({ key: v.string(), value: v.string() }))),
    health: v.optional(
      v.object({
        status: v.union(
          v.literal("healthy"),
          v.literal("degraded"),
          v.literal("unhealthy"),
          v.literal("unknown"),
        ),
        lastCheckedAt: v.optional(v.number()),
        nextCheckAt: v.optional(v.number()),
        detail: v.optional(v.string()),
      }),
    ),
    secretReferenceNames: v.optional(v.array(v.string())),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
  })
    .index("by_organization_binding_key", ["organizationId", "bindingKey"])
    .index("by_organization_provider_status", ["organizationId", "provider", "status"])
    .index("by_organization_updated_at", ["organizationId", "updatedAt"]),

  webhookEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    // Digest is metadata-only replay binding; raw Clerk payloads are never stored.
    payloadHash: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    eventTimestamp: v.optional(v.number()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_received_at", ["receivedAt"]),

  // Task 5: canonical customers + immutable import provenance.
  sourceArtifacts: defineTable({
    organizationId: v.id("organizations"),
    storageId: v.id("_storage"),
    originalFilename: v.string(),
    mimeType: v.string(),
    byteSize: v.number(),
    sha256: v.string(),
    uploadedBy: v.id("users"),
    createdAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("ready"), v.literal("rejected")),
  })
    .index("by_organization_sha256", ["organizationId", "sha256"])
    .index("by_organization_created_at", ["organizationId", "createdAt"])
    .index("by_organization_storage", ["organizationId", "storageId"])
    .index("by_storage", ["storageId"]),

  customers: defineTable({
    organizationId: v.id("organizations"),
    displayName: v.string(),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    mergedInto: v.optional(v.id("customers")),
    createdAt: v.number(),
  })
    .index("by_organization_phone", ["organizationId", "phone"])
    .index("by_organization_email", ["organizationId", "email"])
    .index("by_organization_name", ["organizationId", "displayName"])
    .searchIndex("search_name", { searchField: "displayName", filterFields: ["organizationId"] }),

  importBatches: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    artifactId: v.optional(v.id("sourceArtifacts")),
    mappingVersion: v.optional(v.string()),
    status: v.union(v.literal("staged"), v.literal("committed"), v.literal("approved")),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_organization", ["organizationId"])
    .index("by_organization_created_at", ["organizationId", "createdAt"]),

  // Raw fields and evidence are write-once provenance. Resolution fields are
  // deliberately separate so controlled review can never rewrite the source.
  importRows: defineTable({
    organizationId: v.id("organizations"),
    batchId: v.id("importBatches"),
    rowIndex: v.number(),
    rawName: v.optional(v.string()),
    rawPhone: v.optional(v.string()),
    rawEmail: v.optional(v.string()),
    normalizedPhone: v.optional(v.string()),
    normalizedEmail: v.optional(v.string()),
    mappingVersion: v.string(),
    consent,
    consentSource: v.optional(v.string()),
    consentEvidenceAt: v.optional(v.number()),
    validationStatus: v.union(v.literal("valid"), v.literal("invalid")),
    exclusionReason: v.optional(v.string()),
    resolutionExclusionReason: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    eligible: v.boolean(),
    createdAt: v.number(),
    committedAt: v.optional(v.number()),
  })
    .index("by_organization_batch", ["organizationId", "batchId"])
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_eligible", ["organizationId", "eligible"])
    .index("by_batch_row", ["batchId", "rowIndex"]),

  customerIdentities: defineTable({
    organizationId: v.id("organizations"),
    kind: v.union(v.literal("phone"), v.literal("email"), v.literal("external")),
    normalizedValue: v.string(),
    customerId: v.id("customers"),
    sourceRowId: v.optional(v.id("importRows")),
    createdAt: v.number(),
  })
    .index("by_organization_identity", ["organizationId", "kind", "normalizedValue"])
    .index("by_organization_customer", ["organizationId", "customerId"]),

  identityReviewItems: defineTable({
    organizationId: v.id("organizations"),
    importRowId: v.id("importRows"),
    candidateCustomerIds: v.array(v.id("customers")),
    reason: v.string(),
    status: v.union(v.literal("open"), v.literal("resolved"), v.literal("merged")),
    resolvedCustomerId: v.optional(v.id("customers")),
    createdBy: v.id("users"),
    resolvedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_row", ["organizationId", "importRowId"]),

  customerMergeRecords: defineTable({
    organizationId: v.id("organizations"),
    sourceCustomerId: v.id("customers"),
    targetCustomerId: v.id("customers"),
    mergedBy: v.id("users"),
    createdAt: v.number(),
  }).index("by_organization_created_at", ["organizationId", "createdAt"]),

  sourceRows: defineTable({
    organizationId: v.id("organizations"),
    batchId: v.id("importBatches"),
    rowIndex: v.number(),
    rawName: v.optional(v.string()),
    rawPhone: v.optional(v.string()),
    rawEmail: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
    consent,
    customerId: v.optional(v.id("customers")),
    createdAt: v.number(),
  })
    .index("by_batch", ["batchId"])
    .index("by_organization_batch", ["organizationId", "batchId"])
    .index("by_organization_customer", ["organizationId", "customerId"]),
  // Task 6: append-only event ledger, provider call runs, typed outcomes,
  // conversations and interactions.
  operationEvents: defineTable({
    organizationId: v.id("organizations"),
    actor: v.optional(v.id("users")),
    type: v.string(),
    targetType: v.string(),
    targetId: v.string(),
    correlationId: v.optional(v.string()),
    payload: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization_time", ["organizationId", "createdAt"])
    .index("by_organization_target", ["organizationId", "targetType", "targetId"]),

  providerRuns: defineTable({
    organizationId: v.id("organizations"),
    // Optional makes additive/backfill migrations safe: the real provider id is
    // attached when Dograh returns it, while workstationRunId exists pre-call.
    providerRunId: v.optional(v.string()),
    workstationRunId: v.string(),
    campaignId: v.optional(v.id("campaigns")),
    providerCampaignId: v.optional(v.number()),
    providerWorkflowId: v.optional(v.number()),
    customerId: v.optional(v.id("customers")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    state: v.string(),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    recordingUrl: v.optional(v.string()),
    transcriptUrl: v.optional(v.string()),
    rawContext: v.optional(v.string()),
    rawContextVersion: v.optional(v.number()),
    outcomeId: v.optional(v.id("callOutcomes")),
    lastCallbackAt: v.optional(v.number()),
    lastSequenceNumber: v.optional(v.number()),
    terminalAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_workstation_run", ["workstationRunId"])
    .index("by_provider_run", ["providerRunId"])
    .index("by_organization_provider_run", ["organizationId", "providerRunId"])
    .index("by_organization_workstation_run", ["organizationId", "workstationRunId"])
    .index("by_organization_campaign", ["organizationId", "campaignId"])
    .index("by_organization_customer", ["organizationId", "customerId"]),

  callOutcomes: defineTable({
    organizationId: v.id("organizations"),
    providerRunId: v.optional(v.string()),
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    interactionId: v.optional(v.id("interactions")),
    version: v.number(),
    outcomeType: v.union(
      v.literal("no_outcome"),
      v.literal("reached"),
      v.literal("qualified"),
      v.literal("booking_requested"),
      v.literal("human_handoff_requested"),
      v.literal("quote_requested"),
      v.literal("payment_promised"),
      v.literal("dispute"),
      v.literal("follow_up_required"),
    ),
    fields: v.object({
      resolution: v.optional(v.string()),
      reached: v.optional(v.boolean()),
      qualified: v.optional(v.boolean()),
      bookingRequested: v.optional(v.boolean()),
      // Kept for additive compatibility, but provider-derived values are false.
      bookingConfirmed: v.optional(v.boolean()),
      handoffRequested: v.optional(v.boolean()),
      quoteRequested: v.optional(v.boolean()),
      paymentPromise: v.optional(v.boolean()),
      dispute: v.optional(v.boolean()),
      followUpRequired: v.optional(v.boolean()),
      sentiment: v.optional(v.string()),
      summary: v.optional(v.string()),
    }),
    customFields: v.optional(v.array(v.object({ key: v.string(), value: v.string() }))),
    createdAt: v.number(),
  })
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_provider_run", ["organizationId", "providerRunId"])
    .index("by_provider_run", ["providerRunId"]),

  conversations: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    channel: v.union(v.literal("voice"), v.literal("message"), v.literal("email")),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    startedAt: v.number(),
    lastActivityAt: v.number(),
    lastSummary: v.optional(v.string()),
  }).index("by_organization_customer_time", ["organizationId", "customerId", "lastActivityAt"]),

  interactions: defineTable({
    organizationId: v.id("organizations"),
    conversationId: v.id("conversations"),
    customerId: v.id("customers"),
    opportunityId: v.optional(v.id("opportunities")),
    providerRunId: v.optional(v.string()),
    direction: v.union(v.literal("inbound"), v.literal("outbound")),
    at: v.number(),
    durationMs: v.optional(v.number()),
    summary: v.optional(v.string()),
    outcomeId: v.optional(v.id("callOutcomes")),
    recordingUrl: v.optional(v.string()),
    transcriptUrl: v.optional(v.string()),
  })
    .index("by_organization_customer_time", ["organizationId", "customerId", "at"])
    .index("by_organization_provider_run", ["organizationId", "providerRunId"])
    .index("by_organization_conversation", ["organizationId", "conversationId"]),
  // Task 7: appointments, human work items, and the delivery outbox.
  appointments: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    outcomeId: v.optional(v.id("callOutcomes")),
    opportunityId: v.optional(v.id("opportunities")),
    status: v.union(
      v.literal("requested"),
      v.literal("confirmed"),
      v.literal("cancelled"),
      v.literal("no_show"),
      v.literal("completed"),
    ),
    requestedAt: v.optional(v.number()),
    scheduledFor: v.optional(v.number()),
    title: v.optional(v.string()),
    note: v.optional(v.string()),
    sourceType: v.optional(v.string()),
    sourceExternalId: v.optional(v.string()),
    authoritativeExternalId: v.optional(v.string()),
    readbackEvidence: v.optional(v.string()),
    bindingId: v.optional(v.id("integrationBindings")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_source", ["organizationId", "sourceType", "sourceExternalId"])
    .index("by_organization_scheduled", ["organizationId", "scheduledFor"]),

  workItems: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    conversationId: v.optional(v.id("conversations")),
    type: v.union(
      v.literal("dispute"),
      v.literal("handoff"),
      v.literal("follow_up"),
      v.literal("escalation"),
    ),
    status: v.union(
      v.literal("open"),
      v.literal("assigned"),
      v.literal("investigating"),
      v.literal("waiting_for_customer"),
      v.literal("resolved"),
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("urgent"),
    ),
    assignee: v.optional(v.id("users")),
    team: v.optional(v.string()),
    dueAt: v.optional(v.number()),
    slaDueAt: v.optional(v.number()),
    sentiment: v.optional(v.string()),
    aiSummary: v.optional(v.string()),
    evidenceLinks: v.optional(
      v.array(v.object({ table: v.string(), id: v.string(), label: v.optional(v.string()) })),
    ),
    resolution: v.optional(v.string()),
    followUpProposal: v.optional(
      v.object({
        note: v.string(),
        dueAt: v.optional(v.number()),
        proposedAt: v.number(),
        proposedBy: v.id("users"),
      }),
    ),
    sourceProviderRunId: v.optional(v.string()),
    sourceOutcomeId: v.optional(v.id("callOutcomes")),
    sourceType: v.optional(v.string()),
    dedupeKey: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_due", ["organizationId", "dueAt"])
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_assignee", ["organizationId", "assignee"])
    .index("by_organization_dedupe", ["organizationId", "dedupeKey"]),

  deliveries: defineTable({
    organizationId: v.id("organizations"),
    idempotencyKey: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("claimed"),
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("ambiguous"),
      v.literal("reconciliation_required"),
    ),
    target: v.union(
      v.literal("twenty_person"),
      v.literal("twenty_note"),
      v.literal("twenty_task"),
      v.literal("twenty_appointment"),
    ),
    payload: v.string(),
    payloadHash: v.optional(v.string()),
    payloadVersion: v.optional(v.number()),
    bindingId: v.optional(v.id("integrationBindings")),
    bindingKey: v.optional(v.string()),
    providerRunId: v.optional(v.string()),
    customerId: v.optional(v.id("customers")),
    attempts: v.number(),
    maxAttempts: v.number(),
    leaseToken: v.optional(v.string()),
    leaseClaimedAt: v.optional(v.number()),
    leaseExpiresAt: v.optional(v.number()),
    externalIds: v.optional(v.array(v.string())),
    readbackEvidence: v.optional(v.string()),
    reconciliationAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    nextAttemptAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_status_next", ["organizationId", "status", "nextAttemptAt"])
    .index("by_organization_idem", ["organizationId", "idempotencyKey"])
    .index("by_organization_lease", ["organizationId", "leaseExpiresAt"]),
  // Task 8: campaigns, campaign members, provider state, reconciliation.
  campaigns: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    // `status` is retained as a read-compatible legacy alias. New writes use
    // businessStatus and providerExecutionState independently.
    status: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("approved"),
        v.literal("starting"),
        v.literal("running"),
        v.literal("pausing"),
        v.literal("paused"),
        v.literal("resuming"),
        v.literal("failed"),
        v.literal("completed"),
        v.literal("reconciliation_required"),
      ),
    ),
    businessStatus: v.optional(
      v.union(
        v.literal("draft"),
        v.literal("approved"),
        v.literal("starting"),
        v.literal("running"),
        v.literal("pausing"),
        v.literal("paused"),
        v.literal("resuming"),
        v.literal("failed"),
        v.literal("completed"),
        v.literal("reconciliation_required"),
      ),
    ),
    providerExecutionState: v.optional(v.string()),
    workflowId: v.optional(v.number()),
    agentRole: v.optional(v.string()),
    agentWorkflowBinding: v.optional(
      v.object({ organizationId: v.string(), workflowId: v.string() }),
    ),
    bindingId: v.optional(v.id("integrationBindings")),
    providerOrganizationId: v.optional(v.string()),
    providerWorkflowId: v.optional(v.string()),
    dograhCampaignId: v.optional(v.number()),
    approvedBatchId: v.optional(v.id("importBatches")),
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    draftIdempotencyKey: v.optional(v.string()),
    providerState: v.optional(v.string()),
    totalRows: v.optional(v.number()),
    processedRows: v.optional(v.number()),
    failedRows: v.optional(v.number()),
    progressPercentage: v.optional(v.number()),
    claimToken: v.optional(v.string()),
    claimType: v.optional(
      v.union(v.literal("start"), v.literal("pause"), v.literal("resume"), v.literal("reconcile")),
    ),
    claimStartedAt: v.optional(v.number()),
    claimExpiresAt: v.optional(v.number()),
    lastSyncedAt: v.optional(v.number()),
    lastReconciledAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    errorCategory: v.optional(
      v.union(
        v.literal("validation"),
        v.literal("provider"),
        v.literal("timeout"),
        v.literal("transport"),
        v.literal("malformed"),
        v.literal("reconciliation"),
      ),
    ),
    reconciliationRequired: v.optional(v.boolean()),
    reconciliationWorkItemId: v.optional(v.id("campaignReconciliationItems")),
    createdBy: v.optional(v.id("users")),
    updatedBy: v.optional(v.id("users")),
    auditRef: v.optional(v.string()),
    lastCommandIdempotencyKey: v.optional(v.string()),
    lastCommand: v.optional(
      v.union(v.literal("start"), v.literal("pause"), v.literal("resume"), v.literal("reconcile")),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_status", ["organizationId", "businessStatus"])
    .index("by_organization_provider_state", ["organizationId", "providerExecutionState"])
    .index("by_organization_updated", ["organizationId", "updatedAt"])
    .index("by_organization_draft_idempotency", ["organizationId", "draftIdempotencyKey"])
    .index("by_organization_reconciliation", ["organizationId", "reconciliationRequired"]),

  campaignMembers: defineTable({
    organizationId: v.id("organizations"),
    campaignId: v.id("campaigns"),
    customerId: v.id("customers"),
    sourceRowId: v.optional(v.id("sourceRows")),
    sourceImportRowId: v.optional(v.id("importRows")),
    consent: v.optional(consent),
    callDisposition: v.optional(v.string()),
    // Compatibility status remains separate from the call disposition.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("called"),
        v.literal("processed"),
        v.literal("skipped"),
      ),
    ),
    workstationRunId: v.string(),
    providerRunId: v.optional(v.string()),
    dograhProviderRunId: v.optional(v.string()),
    providerCampaignId: v.optional(v.number()),
    providerWorkflowId: v.optional(v.number()),
    lastCallbackAt: v.optional(v.number()),
    createdAt: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
    auditRef: v.optional(v.string()),
  })
    .index("by_organization_campaign", ["organizationId", "campaignId"])
    .index("by_organization_campaign_customer", ["organizationId", "campaignId", "customerId"])
    .index("by_organization_campaign_status", ["organizationId", "campaignId", "status"])
    .index("by_workstation_run", ["workstationRunId"]),
  campaignReconciliationItems: defineTable({
    organizationId: v.id("organizations"),
    campaignId: v.id("campaigns"),
    status: v.union(v.literal("open"), v.literal("resolved")),
    reason: v.string(),
    createdAt: v.number(),
    resolvedAt: v.optional(v.number()),
  })
    .index("by_organization_campaign_status", ["organizationId", "campaignId", "status"])
    .index("by_organization_status", ["organizationId", "status"]),
  // Task 9: commercial evidence, opportunities, deterministic attribution.
  opportunities: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    sourceType: v.optional(v.string()),
    sourcePursuitId: v.optional(v.string()),
    sourceRowId: v.optional(v.id("importRows")),
    title: v.string(),
    stage: v.string(),
    expectedValueMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    status: v.union(v.literal("open"), v.literal("won"), v.literal("lost")),
    terminalOutcome: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_source_pursuit", ["organizationId", "sourceType", "sourcePursuitId"])
    .index("by_organization_updated_at", ["organizationId", "updatedAt"]),

  commercialOutcomes: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    opportunityId: v.optional(v.id("opportunities")),
    kind: v.union(
      v.literal("booking"),
      v.literal("quote"),
      v.literal("sale"),
      v.literal("closed_won"),
      v.literal("payment_promise"),
      v.literal("payment"),
      v.literal("estimated_booking"),
    ),
    status: v.union(v.literal("estimated"), v.literal("confirmed"), v.literal("collected")),
    amountMinor: v.optional(v.number()),
    currency: v.optional(v.string()),
    sourceType: v.string(),
    sourceExternalId: v.string(),
    evidenceAt: v.number(),
    verifiedAt: v.optional(v.number()),
    evidenceReference: v.optional(v.string()),
    evidenceHash: v.optional(v.string()),
    coverageState: v.union(
      v.literal("verified"),
      v.literal("partial"),
      v.literal("unverified"),
      v.literal("unknown"),
    ),
    publicationState: v.union(v.literal("shadow"), v.literal("published"), v.literal("withheld")),
    authoritativeExternalId: v.optional(v.string()),
    readbackEvidence: v.optional(v.string()),
    interactionId: v.optional(v.id("interactions")),
    providerRunId: v.optional(v.string()),
    recovered: v.boolean(),
    priorState: v.optional(
      v.union(v.literal("missed"), v.literal("stale"), v.literal("no_show"), v.literal("overdue")),
    ),
    confidence: v.optional(v.number()),
    note: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization_customer", ["organizationId", "customerId"])
    .index("by_organization_source", ["organizationId", "sourceType", "sourceExternalId"])
    .index("by_organization_time", ["organizationId", "evidenceAt"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_currency", ["organizationId", "currency"])
    .index("by_organization_opportunity", ["organizationId", "opportunityId"])
    .index("by_organization_interaction", ["organizationId", "interactionId"])
    .index("by_organization_provider_run", ["organizationId", "providerRunId"]),

  attributions: defineTable({
    organizationId: v.id("organizations"),
    commercialOutcomeId: v.id("commercialOutcomes"),
    opportunityId: v.optional(v.id("opportunities")),
    interactionId: v.optional(v.id("interactions")),
    rule: v.string(),
    ruleVersion: v.string(),
    windowMs: v.number(),
    influenced: v.boolean(),
    recovered: v.boolean(),
    priorStateEvidence: v.optional(
      v.object({
        state: v.union(
          v.literal("missed"),
          v.literal("stale"),
          v.literal("no_show"),
          v.literal("overdue"),
        ),
        evidencedAt: v.number(),
        sourceType: v.string(),
        sourceExternalId: v.string(),
        evidenceReference: v.optional(v.string()),
      }),
    ),
    confidence: v.number(),
    explanation: v.string(),
    providerRunId: v.optional(v.string()),
    attributedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_organization_outcome", ["organizationId", "commercialOutcomeId"])
    .index("by_organization_opportunity", ["organizationId", "opportunityId"])
    .index("by_organization_interaction", ["organizationId", "interactionId"]),

  opportunityStateEvidence: defineTable({
    organizationId: v.id("organizations"),
    customerId: v.id("customers"),
    opportunityId: v.optional(v.id("opportunities")),
    state: v.union(
      v.literal("missed"),
      v.literal("stale"),
      v.literal("no_show"),
      v.literal("overdue"),
    ),
    evidencedAt: v.number(),
    sourceType: v.string(),
    sourceExternalId: v.string(),
    evidenceReference: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_organization_customer_time", ["organizationId", "customerId", "evidencedAt"])
    .index("by_organization_opportunity_time", ["organizationId", "opportunityId", "evidencedAt"])
    .index("by_organization_source", ["organizationId", "sourceType", "sourceExternalId"]),

  commercialComparisons: defineTable({
    organizationId: v.id("organizations"),
    sourceType: v.string(),
    comparedAt: v.number(),
    sourceMappingVerified: v.boolean(),
    discrepancyCount: v.number(),
    missingCurrency: v.boolean(),
    staleEvidence: v.boolean(),
    policyComplete: v.boolean(),
    detail: v.optional(v.string()),
  })
    .index("by_organization_time", ["organizationId", "comparedAt"])
    .index("by_organization_source_time", ["organizationId", "sourceType", "comparedAt"]),

  // Calling console: the owner-facing lead -> Dograh call -> Twenty loop.
  workspaceConfig: defineTable({
    organizationId: v.id("organizations"),
    businessName: v.string(),
    leadAgentWorkflowId: v.optional(v.number()),
    crmSyncEnabled: v.boolean(),
    onboardingStartedAt: v.optional(v.number()),
    onboardingBusinessNamedAt: v.optional(v.number()),
    onboardingDismissedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_organization", ["organizationId"]),

  leads: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    phone: v.string(),
    email: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: leadSource,
    twentyPersonId: v.optional(v.string()),
    status: leadStatus,
    attempts: v.number(),
    lastCallId: v.optional(v.id("calls")),
    lastOutcome: v.optional(v.string()),
    lastCalledAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_phone", ["organizationId", "phone"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_organization_created", ["organizationId", "createdAt"]),

  callBatches: defineTable({
    organizationId: v.id("organizations"),
    name: v.string(),
    agentWorkflowId: v.number(),
    dograhCampaignId: v.optional(v.number()),
    status: batchStatus,
    totalCalls: v.number(),
    error: v.optional(v.string()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_status", ["status"]),

  calls: defineTable({
    organizationId: v.id("organizations"),
    kind: v.union(v.literal("campaign"), v.literal("quick")),
    leadId: v.optional(v.id("leads")),
    batchId: v.optional(v.id("callBatches")),
    phone: v.string(),
    contactName: v.optional(v.string()),
    brief: v.optional(v.string()),
    agentWorkflowId: v.number(),
    status: callStatus,
    dograhRunId: v.optional(v.number()),
    dograhRunName: v.optional(v.string()),
    error: v.optional(v.string()),
    disposition: v.optional(v.string()),
    durationSeconds: v.optional(v.number()),
    summary: v.optional(v.string()),
    answers: v.optional(v.string()),
    followUpRequired: v.optional(v.boolean()),
    extracted: v.optional(v.string()),
    transcript: v.optional(v.string()),
    recordingUrl: v.optional(v.string()),
    transcriptUrl: v.optional(v.string()),
    crmStatus: crmStatus,
    crmError: v.optional(v.string()),
    crmPersonId: v.optional(v.string()),
    crmNoteId: v.optional(v.string()),
    crmClaimedAt: v.optional(v.number()),
    createdBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    pollCount: v.number(),
  })
    .index("by_organization_created", ["organizationId", "createdAt"])
    .index("by_organization_status", ["organizationId", "status"])
    .index("by_batch", ["batchId"])
    .index("by_lead", ["leadId"])
    .index("by_dograh_run", ["dograhRunId"])
    .index("by_status_updated", ["status", "updatedAt"])
    .index("by_crm_status", ["crmStatus"]),
});
