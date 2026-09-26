/* eslint-disable */
/**
 * Generated data model types.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  DocumentByName,
  TableNamesInDataModel,
  SystemTableNames,
  AnyDataModel,
} from "convex/server";
import type { GenericId } from "convex/values";

/**
 * A type describing your Convex data model.
 *
 * This type includes information about what tables you have, the type of
 * documents stored in those tables, and the indexes defined on them.
 *
 * This type is used to parameterize methods like `queryGeneric` and
 * `mutationGeneric` to make them type-safe.
 */

export type DataModel = {
  appointments: {
    document: {
      authoritativeExternalId?: string;
      bindingId?: Id<"integrationBindings">;
      conversationId?: Id<"conversations">;
      createdAt: number;
      customerId: Id<"customers">;
      note?: string;
      opportunityId?: Id<"opportunities">;
      organizationId: Id<"organizations">;
      outcomeId?: Id<"callOutcomes">;
      readbackEvidence?: string;
      requestedAt?: number;
      scheduledFor?: number;
      sourceExternalId?: string;
      sourceType?: string;
      status: "requested" | "confirmed" | "cancelled" | "no_show" | "completed";
      title?: string;
      updatedAt: number;
      _id: Id<"appointments">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "authoritativeExternalId"
      | "bindingId"
      | "conversationId"
      | "createdAt"
      | "customerId"
      | "note"
      | "opportunityId"
      | "organizationId"
      | "outcomeId"
      | "readbackEvidence"
      | "requestedAt"
      | "scheduledFor"
      | "sourceExternalId"
      | "sourceType"
      | "status"
      | "title"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_scheduled: [
        "organizationId",
        "scheduledFor",
        "_creationTime",
      ];
      by_organization_source: [
        "organizationId",
        "sourceType",
        "sourceExternalId",
        "_creationTime",
      ];
      by_organization_status: ["organizationId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  attributions: {
    document: {
      attributedAt: number;
      commercialOutcomeId: Id<"commercialOutcomes">;
      confidence: number;
      createdAt: number;
      explanation: string;
      influenced: boolean;
      interactionId?: Id<"interactions">;
      opportunityId?: Id<"opportunities">;
      organizationId: Id<"organizations">;
      priorStateEvidence?: {
        evidenceReference?: string;
        evidencedAt: number;
        sourceExternalId: string;
        sourceType: string;
        state: "missed" | "stale" | "no_show" | "overdue";
      };
      providerRunId?: string;
      recovered: boolean;
      rule: string;
      ruleVersion: string;
      windowMs: number;
      _id: Id<"attributions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attributedAt"
      | "commercialOutcomeId"
      | "confidence"
      | "createdAt"
      | "explanation"
      | "influenced"
      | "interactionId"
      | "opportunityId"
      | "organizationId"
      | "priorStateEvidence"
      | "priorStateEvidence.evidencedAt"
      | "priorStateEvidence.evidenceReference"
      | "priorStateEvidence.sourceExternalId"
      | "priorStateEvidence.sourceType"
      | "priorStateEvidence.state"
      | "providerRunId"
      | "recovered"
      | "rule"
      | "ruleVersion"
      | "windowMs";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_interaction: [
        "organizationId",
        "interactionId",
        "_creationTime",
      ];
      by_organization_opportunity: [
        "organizationId",
        "opportunityId",
        "_creationTime",
      ];
      by_organization_outcome: [
        "organizationId",
        "commercialOutcomeId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  callBatches: {
    document: {
      agentWorkflowId: number;
      createdAt: number;
      createdBy?: Id<"users">;
      dograhCampaignId?: number;
      error?: string;
      name: string;
      organizationId: Id<"organizations">;
      status: "creating" | "running" | "paused" | "completed" | "failed";
      totalCalls: number;
      updatedAt: number;
      _id: Id<"callBatches">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "agentWorkflowId"
      | "createdAt"
      | "createdBy"
      | "dograhCampaignId"
      | "error"
      | "name"
      | "organizationId"
      | "status"
      | "totalCalls"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_created: ["organizationId", "createdAt", "_creationTime"];
      by_status: ["status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  callOutcomes: {
    document: {
      conversationId?: Id<"conversations">;
      createdAt: number;
      customFields?: Array<{ key: string; value: string }>;
      customerId: Id<"customers">;
      fields: {
        bookingConfirmed?: boolean;
        bookingRequested?: boolean;
        dispute?: boolean;
        followUpRequired?: boolean;
        handoffRequested?: boolean;
        paymentPromise?: boolean;
        qualified?: boolean;
        quoteRequested?: boolean;
        reached?: boolean;
        resolution?: string;
        sentiment?: string;
        summary?: string;
      };
      interactionId?: Id<"interactions">;
      organizationId: Id<"organizations">;
      outcomeType:
        | "no_outcome"
        | "reached"
        | "qualified"
        | "booking_requested"
        | "human_handoff_requested"
        | "quote_requested"
        | "payment_promised"
        | "dispute"
        | "follow_up_required";
      providerRunId?: string;
      version: number;
      _id: Id<"callOutcomes">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "conversationId"
      | "createdAt"
      | "customerId"
      | "customFields"
      | "fields"
      | "fields.bookingConfirmed"
      | "fields.bookingRequested"
      | "fields.dispute"
      | "fields.followUpRequired"
      | "fields.handoffRequested"
      | "fields.paymentPromise"
      | "fields.qualified"
      | "fields.quoteRequested"
      | "fields.reached"
      | "fields.resolution"
      | "fields.sentiment"
      | "fields.summary"
      | "interactionId"
      | "organizationId"
      | "outcomeType"
      | "providerRunId"
      | "version";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_provider_run: [
        "organizationId",
        "providerRunId",
        "_creationTime",
      ];
      by_provider_run: ["providerRunId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  calls: {
    document: {
      agentWorkflowId: number;
      answers?: string;
      batchId?: Id<"callBatches">;
      brief?: string;
      completedAt?: number;
      contactName?: string;
      createdAt: number;
      createdBy?: Id<"users">;
      crmClaimedAt?: number;
      crmError?: string;
      crmNoteId?: string;
      crmPersonId?: string;
      crmStatus: "pending" | "synced" | "failed" | "skipped";
      disposition?: string;
      dograhRunId?: number;
      dograhRunName?: string;
      durationSeconds?: number;
      error?: string;
      extracted?: string;
      followUpRequired?: boolean;
      kind: "campaign" | "quick";
      leadId?: Id<"leads">;
      organizationId: Id<"organizations">;
      phone: string;
      pollCount: number;
      recordingUrl?: string;
      startedAt?: number;
      status: "queued" | "in_progress" | "completed" | "no_answer" | "failed";
      summary?: string;
      transcript?: string;
      transcriptUrl?: string;
      updatedAt: number;
      _id: Id<"calls">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "agentWorkflowId"
      | "answers"
      | "batchId"
      | "brief"
      | "completedAt"
      | "contactName"
      | "createdAt"
      | "createdBy"
      | "crmClaimedAt"
      | "crmError"
      | "crmNoteId"
      | "crmPersonId"
      | "crmStatus"
      | "disposition"
      | "dograhRunId"
      | "dograhRunName"
      | "durationSeconds"
      | "error"
      | "extracted"
      | "followUpRequired"
      | "kind"
      | "leadId"
      | "organizationId"
      | "phone"
      | "pollCount"
      | "recordingUrl"
      | "startedAt"
      | "status"
      | "summary"
      | "transcript"
      | "transcriptUrl"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_batch: ["batchId", "_creationTime"];
      by_crm_status: ["crmStatus", "_creationTime"];
      by_dograh_run: ["dograhRunId", "_creationTime"];
      by_lead: ["leadId", "_creationTime"];
      by_organization_created: ["organizationId", "createdAt", "_creationTime"];
      by_organization_status: ["organizationId", "status", "_creationTime"];
      by_status_updated: ["status", "updatedAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  campaignMembers: {
    document: {
      auditRef?: string;
      callDisposition?: string;
      campaignId: Id<"campaigns">;
      consent?: "consented" | "unconsented" | "unknown";
      createdAt?: number;
      customerId: Id<"customers">;
      dograhProviderRunId?: string;
      lastCallbackAt?: number;
      organizationId: Id<"organizations">;
      providerCampaignId?: number;
      providerRunId?: string;
      providerWorkflowId?: number;
      sourceImportRowId?: Id<"importRows">;
      sourceRowId?: Id<"sourceRows">;
      status?: "pending" | "called" | "processed" | "skipped";
      updatedAt?: number;
      workstationRunId: string;
      _id: Id<"campaignMembers">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "auditRef"
      | "callDisposition"
      | "campaignId"
      | "consent"
      | "createdAt"
      | "customerId"
      | "dograhProviderRunId"
      | "lastCallbackAt"
      | "organizationId"
      | "providerCampaignId"
      | "providerRunId"
      | "providerWorkflowId"
      | "sourceImportRowId"
      | "sourceRowId"
      | "status"
      | "updatedAt"
      | "workstationRunId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_campaign: [
        "organizationId",
        "campaignId",
        "_creationTime",
      ];
      by_organization_campaign_customer: [
        "organizationId",
        "campaignId",
        "customerId",
        "_creationTime",
      ];
      by_organization_campaign_status: [
        "organizationId",
        "campaignId",
        "status",
        "_creationTime",
      ];
      by_workstation_run: ["workstationRunId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  campaignReconciliationItems: {
    document: {
      campaignId: Id<"campaigns">;
      createdAt: number;
      organizationId: Id<"organizations">;
      reason: string;
      resolvedAt?: number;
      status: "open" | "resolved";
      _id: Id<"campaignReconciliationItems">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "campaignId"
      | "createdAt"
      | "organizationId"
      | "reason"
      | "resolvedAt"
      | "status";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_campaign_status: [
        "organizationId",
        "campaignId",
        "status",
        "_creationTime",
      ];
      by_organization_status: ["organizationId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  campaigns: {
    document: {
      agentRole?: string;
      agentWorkflowBinding?: { organizationId: string; workflowId: string };
      approvedAt?: number;
      approvedBatchId?: Id<"importBatches">;
      approvedBy?: Id<"users">;
      auditRef?: string;
      bindingId?: Id<"integrationBindings">;
      businessStatus?:
        | "draft"
        | "approved"
        | "starting"
        | "running"
        | "pausing"
        | "paused"
        | "resuming"
        | "failed"
        | "completed"
        | "reconciliation_required";
      claimExpiresAt?: number;
      claimStartedAt?: number;
      claimToken?: string;
      claimType?: "start" | "pause" | "resume" | "reconcile";
      createdAt: number;
      createdBy?: Id<"users">;
      dograhCampaignId?: number;
      draftIdempotencyKey?: string;
      errorCategory?:
        | "validation"
        | "provider"
        | "timeout"
        | "transport"
        | "malformed"
        | "reconciliation";
      failedRows?: number;
      lastCommand?: "start" | "pause" | "resume" | "reconcile";
      lastCommandIdempotencyKey?: string;
      lastError?: string;
      lastReconciledAt?: number;
      lastSyncedAt?: number;
      name: string;
      organizationId: Id<"organizations">;
      processedRows?: number;
      progressPercentage?: number;
      providerExecutionState?: string;
      providerOrganizationId?: string;
      providerState?: string;
      providerWorkflowId?: string;
      reconciliationRequired?: boolean;
      reconciliationWorkItemId?: Id<"campaignReconciliationItems">;
      status?:
        | "draft"
        | "approved"
        | "starting"
        | "running"
        | "pausing"
        | "paused"
        | "resuming"
        | "failed"
        | "completed"
        | "reconciliation_required";
      totalRows?: number;
      updatedAt: number;
      updatedBy?: Id<"users">;
      workflowId?: number;
      _id: Id<"campaigns">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "agentRole"
      | "agentWorkflowBinding"
      | "agentWorkflowBinding.organizationId"
      | "agentWorkflowBinding.workflowId"
      | "approvedAt"
      | "approvedBatchId"
      | "approvedBy"
      | "auditRef"
      | "bindingId"
      | "businessStatus"
      | "claimExpiresAt"
      | "claimStartedAt"
      | "claimToken"
      | "claimType"
      | "createdAt"
      | "createdBy"
      | "dograhCampaignId"
      | "draftIdempotencyKey"
      | "errorCategory"
      | "failedRows"
      | "lastCommand"
      | "lastCommandIdempotencyKey"
      | "lastError"
      | "lastReconciledAt"
      | "lastSyncedAt"
      | "name"
      | "organizationId"
      | "processedRows"
      | "progressPercentage"
      | "providerExecutionState"
      | "providerOrganizationId"
      | "providerState"
      | "providerWorkflowId"
      | "reconciliationRequired"
      | "reconciliationWorkItemId"
      | "status"
      | "totalRows"
      | "updatedAt"
      | "updatedBy"
      | "workflowId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_draft_idempotency: [
        "organizationId",
        "draftIdempotencyKey",
        "_creationTime",
      ];
      by_organization_provider_state: [
        "organizationId",
        "providerExecutionState",
        "_creationTime",
      ];
      by_organization_reconciliation: [
        "organizationId",
        "reconciliationRequired",
        "_creationTime",
      ];
      by_organization_status: [
        "organizationId",
        "businessStatus",
        "_creationTime",
      ];
      by_organization_updated: ["organizationId", "updatedAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  commercialComparisons: {
    document: {
      comparedAt: number;
      detail?: string;
      discrepancyCount: number;
      missingCurrency: boolean;
      organizationId: Id<"organizations">;
      policyComplete: boolean;
      sourceMappingVerified: boolean;
      sourceType: string;
      staleEvidence: boolean;
      _id: Id<"commercialComparisons">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "comparedAt"
      | "detail"
      | "discrepancyCount"
      | "missingCurrency"
      | "organizationId"
      | "policyComplete"
      | "sourceMappingVerified"
      | "sourceType"
      | "staleEvidence";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_source_time: [
        "organizationId",
        "sourceType",
        "comparedAt",
        "_creationTime",
      ];
      by_organization_time: ["organizationId", "comparedAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  commercialOutcomes: {
    document: {
      amountMinor?: number;
      authoritativeExternalId?: string;
      confidence?: number;
      coverageState: "verified" | "partial" | "unverified" | "unknown";
      createdAt: number;
      currency?: string;
      customerId: Id<"customers">;
      evidenceAt: number;
      evidenceHash?: string;
      evidenceReference?: string;
      interactionId?: Id<"interactions">;
      kind:
        | "booking"
        | "quote"
        | "sale"
        | "closed_won"
        | "payment_promise"
        | "payment"
        | "estimated_booking";
      note?: string;
      opportunityId?: Id<"opportunities">;
      organizationId: Id<"organizations">;
      priorState?: "missed" | "stale" | "no_show" | "overdue";
      providerRunId?: string;
      publicationState: "shadow" | "published" | "withheld";
      readbackEvidence?: string;
      recovered: boolean;
      sourceExternalId: string;
      sourceType: string;
      status: "estimated" | "confirmed" | "collected";
      verifiedAt?: number;
      _id: Id<"commercialOutcomes">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "amountMinor"
      | "authoritativeExternalId"
      | "confidence"
      | "coverageState"
      | "createdAt"
      | "currency"
      | "customerId"
      | "evidenceAt"
      | "evidenceHash"
      | "evidenceReference"
      | "interactionId"
      | "kind"
      | "note"
      | "opportunityId"
      | "organizationId"
      | "priorState"
      | "providerRunId"
      | "publicationState"
      | "readbackEvidence"
      | "recovered"
      | "sourceExternalId"
      | "sourceType"
      | "status"
      | "verifiedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_currency: ["organizationId", "currency", "_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_interaction: [
        "organizationId",
        "interactionId",
        "_creationTime",
      ];
      by_organization_opportunity: [
        "organizationId",
        "opportunityId",
        "_creationTime",
      ];
      by_organization_provider_run: [
        "organizationId",
        "providerRunId",
        "_creationTime",
      ];
      by_organization_source: [
        "organizationId",
        "sourceType",
        "sourceExternalId",
        "_creationTime",
      ];
      by_organization_status: ["organizationId", "status", "_creationTime"];
      by_organization_time: ["organizationId", "evidenceAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  conversations: {
    document: {
      channel: "voice" | "message" | "email";
      customerId: Id<"customers">;
      direction: "inbound" | "outbound";
      lastActivityAt: number;
      lastSummary?: string;
      organizationId: Id<"organizations">;
      startedAt: number;
      _id: Id<"conversations">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "channel"
      | "customerId"
      | "direction"
      | "lastActivityAt"
      | "lastSummary"
      | "organizationId"
      | "startedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer_time: [
        "organizationId",
        "customerId",
        "lastActivityAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  customerIdentities: {
    document: {
      createdAt: number;
      customerId: Id<"customers">;
      kind: "phone" | "email" | "external";
      normalizedValue: string;
      organizationId: Id<"organizations">;
      sourceRowId?: Id<"importRows">;
      _id: Id<"customerIdentities">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "customerId"
      | "kind"
      | "normalizedValue"
      | "organizationId"
      | "sourceRowId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_identity: [
        "organizationId",
        "kind",
        "normalizedValue",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  customerMergeRecords: {
    document: {
      createdAt: number;
      mergedBy: Id<"users">;
      organizationId: Id<"organizations">;
      sourceCustomerId: Id<"customers">;
      targetCustomerId: Id<"customers">;
      _id: Id<"customerMergeRecords">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "mergedBy"
      | "organizationId"
      | "sourceCustomerId"
      | "targetCustomerId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_created_at: [
        "organizationId",
        "createdAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  customers: {
    document: {
      createdAt: number;
      displayName: string;
      email?: string;
      mergedInto?: Id<"customers">;
      organizationId: Id<"organizations">;
      phone?: string;
      _id: Id<"customers">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "displayName"
      | "email"
      | "mergedInto"
      | "organizationId"
      | "phone";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_email: ["organizationId", "email", "_creationTime"];
      by_organization_name: ["organizationId", "displayName", "_creationTime"];
      by_organization_phone: ["organizationId", "phone", "_creationTime"];
    };
    searchIndexes: {
      search_name: {
        searchField: "displayName";
        filterFields: "organizationId";
      };
    };
    vectorIndexes: {};
  };
  deliveries: {
    document: {
      attempts: number;
      bindingId?: Id<"integrationBindings">;
      bindingKey?: string;
      completedAt?: number;
      createdAt: number;
      customerId?: Id<"customers">;
      externalIds?: Array<string>;
      idempotencyKey: string;
      lastError?: string;
      leaseClaimedAt?: number;
      leaseExpiresAt?: number;
      leaseToken?: string;
      maxAttempts: number;
      nextAttemptAt?: number;
      organizationId: Id<"organizations">;
      payload: string;
      payloadHash?: string;
      payloadVersion?: number;
      providerRunId?: string;
      readbackEvidence?: string;
      reconciliationAt?: number;
      status:
        | "pending"
        | "claimed"
        | "succeeded"
        | "failed"
        | "ambiguous"
        | "reconciliation_required";
      target:
        "twenty_person" | "twenty_note" | "twenty_task" | "twenty_appointment";
      updatedAt: number;
      _id: Id<"deliveries">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attempts"
      | "bindingId"
      | "bindingKey"
      | "completedAt"
      | "createdAt"
      | "customerId"
      | "externalIds"
      | "idempotencyKey"
      | "lastError"
      | "leaseClaimedAt"
      | "leaseExpiresAt"
      | "leaseToken"
      | "maxAttempts"
      | "nextAttemptAt"
      | "organizationId"
      | "payload"
      | "payloadHash"
      | "payloadVersion"
      | "providerRunId"
      | "readbackEvidence"
      | "reconciliationAt"
      | "status"
      | "target"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_idem: [
        "organizationId",
        "idempotencyKey",
        "_creationTime",
      ];
      by_organization_lease: [
        "organizationId",
        "leaseExpiresAt",
        "_creationTime",
      ];
      by_organization_status_next: [
        "organizationId",
        "status",
        "nextAttemptAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  identityReviewItems: {
    document: {
      candidateCustomerIds: Array<Id<"customers">>;
      createdAt: number;
      createdBy: Id<"users">;
      importRowId: Id<"importRows">;
      organizationId: Id<"organizations">;
      reason: string;
      resolvedAt?: number;
      resolvedBy?: Id<"users">;
      resolvedCustomerId?: Id<"customers">;
      status: "open" | "resolved" | "merged";
      _id: Id<"identityReviewItems">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "candidateCustomerIds"
      | "createdAt"
      | "createdBy"
      | "importRowId"
      | "organizationId"
      | "reason"
      | "resolvedAt"
      | "resolvedBy"
      | "resolvedCustomerId"
      | "status";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_row: ["organizationId", "importRowId", "_creationTime"];
      by_organization_status: ["organizationId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  importBatches: {
    document: {
      artifactId?: Id<"sourceArtifacts">;
      createdAt: number;
      createdBy: Id<"users">;
      mappingVersion?: string;
      name: string;
      organizationId: Id<"organizations">;
      status: "staged" | "committed" | "approved";
      _id: Id<"importBatches">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "artifactId"
      | "createdAt"
      | "createdBy"
      | "mappingVersion"
      | "name"
      | "organizationId"
      | "status";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization: ["organizationId", "_creationTime"];
      by_organization_created_at: [
        "organizationId",
        "createdAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  importRows: {
    document: {
      batchId: Id<"importBatches">;
      committedAt?: number;
      consent: "consented" | "unconsented" | "unknown";
      consentEvidenceAt?: number;
      consentSource?: string;
      createdAt: number;
      customerId?: Id<"customers">;
      eligible: boolean;
      exclusionReason?: string;
      mappingVersion: string;
      normalizedEmail?: string;
      normalizedPhone?: string;
      organizationId: Id<"organizations">;
      rawEmail?: string;
      rawName?: string;
      rawPhone?: string;
      resolutionExclusionReason?: string;
      rowIndex: number;
      validationStatus: "valid" | "invalid";
      _id: Id<"importRows">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "batchId"
      | "committedAt"
      | "consent"
      | "consentEvidenceAt"
      | "consentSource"
      | "createdAt"
      | "customerId"
      | "eligible"
      | "exclusionReason"
      | "mappingVersion"
      | "normalizedEmail"
      | "normalizedPhone"
      | "organizationId"
      | "rawEmail"
      | "rawName"
      | "rawPhone"
      | "resolutionExclusionReason"
      | "rowIndex"
      | "validationStatus";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_batch_row: ["batchId", "rowIndex", "_creationTime"];
      by_organization_batch: ["organizationId", "batchId", "_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_eligible: ["organizationId", "eligible", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  integrationBindings: {
    document: {
      bindingKey: string;
      createdAt: number;
      createdBy?: Id<"users">;
      dograhOrganizationId?: string;
      dograhWorkflowId?: string;
      health?: {
        detail?: string;
        lastCheckedAt?: number;
        nextCheckAt?: number;
        status: "healthy" | "degraded" | "unhealthy" | "unknown";
      };
      metadata?: Array<{ key: string; value: string }>;
      organizationId: Id<"organizations">;
      provider: "dograh" | "twenty" | "hermes";
      secretReferenceNames?: Array<string>;
      status: "active" | "inactive";
      twentyObjectMappings?: Array<{
        twentyObject: string;
        workstationType: string;
      }>;
      twentyWorkspaceId?: string;
      updatedAt: number;
      updatedBy?: Id<"users">;
      _id: Id<"integrationBindings">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "bindingKey"
      | "createdAt"
      | "createdBy"
      | "dograhOrganizationId"
      | "dograhWorkflowId"
      | "health"
      | "health.detail"
      | "health.lastCheckedAt"
      | "health.nextCheckAt"
      | "health.status"
      | "metadata"
      | "organizationId"
      | "provider"
      | "secretReferenceNames"
      | "status"
      | "twentyObjectMappings"
      | "twentyWorkspaceId"
      | "updatedAt"
      | "updatedBy";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_binding_key: [
        "organizationId",
        "bindingKey",
        "_creationTime",
      ];
      by_organization_provider_status: [
        "organizationId",
        "provider",
        "status",
        "_creationTime",
      ];
      by_organization_updated_at: [
        "organizationId",
        "updatedAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  interactions: {
    document: {
      at: number;
      conversationId: Id<"conversations">;
      customerId: Id<"customers">;
      direction: "inbound" | "outbound";
      durationMs?: number;
      opportunityId?: Id<"opportunities">;
      organizationId: Id<"organizations">;
      outcomeId?: Id<"callOutcomes">;
      providerRunId?: string;
      recordingUrl?: string;
      summary?: string;
      transcriptUrl?: string;
      _id: Id<"interactions">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "at"
      | "conversationId"
      | "customerId"
      | "direction"
      | "durationMs"
      | "opportunityId"
      | "organizationId"
      | "outcomeId"
      | "providerRunId"
      | "recordingUrl"
      | "summary"
      | "transcriptUrl";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_conversation: [
        "organizationId",
        "conversationId",
        "_creationTime",
      ];
      by_organization_customer_time: [
        "organizationId",
        "customerId",
        "at",
        "_creationTime",
      ];
      by_organization_provider_run: [
        "organizationId",
        "providerRunId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  leads: {
    document: {
      attempts: number;
      createdAt: number;
      email?: string;
      lastCallId?: Id<"calls">;
      lastCalledAt?: number;
      lastOutcome?: string;
      name: string;
      notes?: string;
      organizationId: Id<"organizations">;
      phone: string;
      source: "csv" | "twenty" | "manual";
      status: "new" | "queued" | "called" | "failed";
      twentyPersonId?: string;
      updatedAt: number;
      _id: Id<"leads">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attempts"
      | "createdAt"
      | "email"
      | "lastCalledAt"
      | "lastCallId"
      | "lastOutcome"
      | "name"
      | "notes"
      | "organizationId"
      | "phone"
      | "source"
      | "status"
      | "twentyPersonId"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_created: ["organizationId", "createdAt", "_creationTime"];
      by_organization_phone: ["organizationId", "phone", "_creationTime"];
      by_organization_status: ["organizationId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  maintenanceState: {
    document: {
      cursor: string | null;
      key: string;
      _id: Id<"maintenanceState">;
      _creationTime: number;
    };
    fieldPaths: "_creationTime" | "_id" | "cursor" | "key";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_key: ["key", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  memberships: {
    document: {
      active?: boolean;
      clerkMembershipId?: string;
      createdAt: number;
      deletedAt?: number;
      lifecycleAt?: number;
      lifecycleVersion?: string;
      organizationId: Id<"organizations">;
      role: "owner" | "operator" | "staff";
      updatedAt?: number;
      userId: Id<"users">;
      _id: Id<"memberships">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "active"
      | "clerkMembershipId"
      | "createdAt"
      | "deletedAt"
      | "lifecycleAt"
      | "lifecycleVersion"
      | "organizationId"
      | "role"
      | "updatedAt"
      | "userId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_clerk_membership_id: ["clerkMembershipId", "_creationTime"];
      by_organization_role: ["organizationId", "role", "_creationTime"];
      by_organization_user: ["organizationId", "userId", "_creationTime"];
      by_user: ["userId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  operationEvents: {
    document: {
      actor?: Id<"users">;
      correlationId?: string;
      createdAt: number;
      organizationId: Id<"organizations">;
      payload?: string;
      targetId: string;
      targetType: string;
      type: string;
      _id: Id<"operationEvents">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "actor"
      | "correlationId"
      | "createdAt"
      | "organizationId"
      | "payload"
      | "targetId"
      | "targetType"
      | "type";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_target: [
        "organizationId",
        "targetType",
        "targetId",
        "_creationTime",
      ];
      by_organization_time: ["organizationId", "createdAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  opportunities: {
    document: {
      createdAt: number;
      currency?: string;
      customerId: Id<"customers">;
      expectedValueMinor?: number;
      organizationId: Id<"organizations">;
      sourcePursuitId?: string;
      sourceRowId?: Id<"importRows">;
      sourceType?: string;
      stage: string;
      status: "open" | "won" | "lost";
      terminalOutcome?: string;
      title: string;
      updatedAt: number;
      _id: Id<"opportunities">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "currency"
      | "customerId"
      | "expectedValueMinor"
      | "organizationId"
      | "sourcePursuitId"
      | "sourceRowId"
      | "sourceType"
      | "stage"
      | "status"
      | "terminalOutcome"
      | "title"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_source_pursuit: [
        "organizationId",
        "sourceType",
        "sourcePursuitId",
        "_creationTime",
      ];
      by_organization_updated_at: [
        "organizationId",
        "updatedAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  opportunityStateEvidence: {
    document: {
      createdAt: number;
      customerId: Id<"customers">;
      evidenceReference?: string;
      evidencedAt: number;
      opportunityId?: Id<"opportunities">;
      organizationId: Id<"organizations">;
      sourceExternalId: string;
      sourceType: string;
      state: "missed" | "stale" | "no_show" | "overdue";
      _id: Id<"opportunityStateEvidence">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "customerId"
      | "evidencedAt"
      | "evidenceReference"
      | "opportunityId"
      | "organizationId"
      | "sourceExternalId"
      | "sourceType"
      | "state";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_customer_time: [
        "organizationId",
        "customerId",
        "evidencedAt",
        "_creationTime",
      ];
      by_organization_opportunity_time: [
        "organizationId",
        "opportunityId",
        "evidencedAt",
        "_creationTime",
      ];
      by_organization_source: [
        "organizationId",
        "sourceType",
        "sourceExternalId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizations: {
    document: {
      active?: boolean;
      clerkOrgId: string;
      createdAt: number;
      deletedAt?: number;
      lifecycleAt?: number;
      lifecycleVersion?: string;
      name: string;
      slug?: string;
      updatedAt?: number;
      _id: Id<"organizations">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "active"
      | "clerkOrgId"
      | "createdAt"
      | "deletedAt"
      | "lifecycleAt"
      | "lifecycleVersion"
      | "name"
      | "slug"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_clerk_org_id: ["clerkOrgId", "_creationTime"];
      by_created_at: ["createdAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  organizationSettings: {
    document: {
      attributionWindow: {
        semantics: "interaction_to_outcome";
        unit: "hours" | "days";
        value: number;
      };
      bookingAuthorityPolicy?: { requireReadback: boolean; sourceType: string };
      businessVertical?: string;
      commercialMetricsMode?: "shadow" | "published";
      createdAt: number;
      createdBy?: Id<"users">;
      defaultCurrency: string;
      expectedBookingValuePolicy: {
        amountMinor?: number;
        currency?: string;
        mode: "none" | "org_wide" | "service" | "opportunity";
        serviceValues?: Array<{
          amountMinor: number;
          currency: string;
          service: string;
        }>;
      };
      healthFreshnessPolicy: {
        criticalAfterMinutes: number;
        warningAfterMinutes: number;
      };
      organizationId: Id<"organizations">;
      paymentAuthorityPolicy?: {
        requireReadback: boolean;
        sourceTypes: Array<string>;
      };
      recoveryPolicy?: {
        enabled: boolean;
        priorStateTypes: Array<"missed" | "stale" | "no_show" | "overdue">;
        window: { unit: "hours" | "days"; value: number };
      };
      timezone: string;
      updatedAt: number;
      updatedBy?: Id<"users">;
      _id: Id<"organizationSettings">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "attributionWindow"
      | "attributionWindow.semantics"
      | "attributionWindow.unit"
      | "attributionWindow.value"
      | "bookingAuthorityPolicy"
      | "bookingAuthorityPolicy.requireReadback"
      | "bookingAuthorityPolicy.sourceType"
      | "businessVertical"
      | "commercialMetricsMode"
      | "createdAt"
      | "createdBy"
      | "defaultCurrency"
      | "expectedBookingValuePolicy"
      | "expectedBookingValuePolicy.amountMinor"
      | "expectedBookingValuePolicy.currency"
      | "expectedBookingValuePolicy.mode"
      | "expectedBookingValuePolicy.serviceValues"
      | "healthFreshnessPolicy"
      | "healthFreshnessPolicy.criticalAfterMinutes"
      | "healthFreshnessPolicy.warningAfterMinutes"
      | "organizationId"
      | "paymentAuthorityPolicy"
      | "paymentAuthorityPolicy.requireReadback"
      | "paymentAuthorityPolicy.sourceTypes"
      | "recoveryPolicy"
      | "recoveryPolicy.enabled"
      | "recoveryPolicy.priorStateTypes"
      | "recoveryPolicy.window"
      | "recoveryPolicy.window.unit"
      | "recoveryPolicy.window.value"
      | "timezone"
      | "updatedAt"
      | "updatedBy";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization: ["organizationId", "_creationTime"];
      by_organization_updated_at: [
        "organizationId",
        "updatedAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  providerRuns: {
    document: {
      campaignId?: Id<"campaigns">;
      createdAt: number;
      customerId?: Id<"customers">;
      direction: "inbound" | "outbound";
      durationMs?: number;
      endedAt?: number;
      lastCallbackAt?: number;
      lastSequenceNumber?: number;
      organizationId: Id<"organizations">;
      outcomeId?: Id<"callOutcomes">;
      providerCampaignId?: number;
      providerRunId?: string;
      providerWorkflowId?: number;
      rawContext?: string;
      rawContextVersion?: number;
      recordingUrl?: string;
      startedAt?: number;
      state: string;
      terminalAt?: number;
      transcriptUrl?: string;
      updatedAt: number;
      workstationRunId: string;
      _id: Id<"providerRuns">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "campaignId"
      | "createdAt"
      | "customerId"
      | "direction"
      | "durationMs"
      | "endedAt"
      | "lastCallbackAt"
      | "lastSequenceNumber"
      | "organizationId"
      | "outcomeId"
      | "providerCampaignId"
      | "providerRunId"
      | "providerWorkflowId"
      | "rawContext"
      | "rawContextVersion"
      | "recordingUrl"
      | "startedAt"
      | "state"
      | "terminalAt"
      | "transcriptUrl"
      | "updatedAt"
      | "workstationRunId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_campaign: [
        "organizationId",
        "campaignId",
        "_creationTime",
      ];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_provider_run: [
        "organizationId",
        "providerRunId",
        "_creationTime",
      ];
      by_organization_workstation_run: [
        "organizationId",
        "workstationRunId",
        "_creationTime",
      ];
      by_provider_run: ["providerRunId", "_creationTime"];
      by_workstation_run: ["workstationRunId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  scheduledEchoes: {
    document: {
      createdAt: number;
      finishedAt?: number;
      organizationId: Id<"organizations">;
      payload: string;
      status: "pending" | "completed" | "failed";
      _id: Id<"scheduledEchoes">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "createdAt"
      | "finishedAt"
      | "organizationId"
      | "payload"
      | "status";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_finished_at: [
        "organizationId",
        "finishedAt",
        "_creationTime",
      ];
      by_organization_status: ["organizationId", "status", "_creationTime"];
      by_organization_status_finished_at: [
        "organizationId",
        "status",
        "finishedAt",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  sourceArtifacts: {
    document: {
      byteSize: number;
      createdAt: number;
      mimeType: string;
      organizationId: Id<"organizations">;
      originalFilename: string;
      sha256: string;
      status: "pending" | "ready" | "rejected";
      storageId: Id<"_storage">;
      uploadedBy: Id<"users">;
      _id: Id<"sourceArtifacts">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "byteSize"
      | "createdAt"
      | "mimeType"
      | "organizationId"
      | "originalFilename"
      | "sha256"
      | "status"
      | "storageId"
      | "uploadedBy";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_created_at: [
        "organizationId",
        "createdAt",
        "_creationTime",
      ];
      by_organization_sha256: ["organizationId", "sha256", "_creationTime"];
      by_organization_storage: ["organizationId", "storageId", "_creationTime"];
      by_storage: ["storageId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  sourceRows: {
    document: {
      batchId: Id<"importBatches">;
      consent: "consented" | "unconsented" | "unknown";
      createdAt: number;
      customerId?: Id<"customers">;
      email?: string;
      organizationId: Id<"organizations">;
      phone?: string;
      rawEmail?: string;
      rawName?: string;
      rawPhone?: string;
      rowIndex: number;
      _id: Id<"sourceRows">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "batchId"
      | "consent"
      | "createdAt"
      | "customerId"
      | "email"
      | "organizationId"
      | "phone"
      | "rawEmail"
      | "rawName"
      | "rawPhone"
      | "rowIndex";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_batch: ["batchId", "_creationTime"];
      by_organization_batch: ["organizationId", "batchId", "_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  toolchainProbes: {
    document: {
      createdAt: number;
      label: string;
      organizationId: Id<"organizations">;
      _id: Id<"toolchainProbes">;
      _creationTime: number;
    };
    fieldPaths:
      "_creationTime" | "_id" | "createdAt" | "label" | "organizationId";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_created_at: [
        "organizationId",
        "createdAt",
        "_creationTime",
      ];
      by_organization_label: ["organizationId", "label", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  users: {
    document: {
      active?: boolean;
      clerkId: string;
      createdAt: number;
      deletedAt?: number;
      email?: string;
      imageUrl?: string;
      lifecycleAt?: number;
      lifecycleVersion?: string;
      name?: string;
      updatedAt?: number;
      _id: Id<"users">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "active"
      | "clerkId"
      | "createdAt"
      | "deletedAt"
      | "email"
      | "imageUrl"
      | "lifecycleAt"
      | "lifecycleVersion"
      | "name"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_clerk_id: ["clerkId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  webhookEvents: {
    document: {
      eventId: string;
      eventTimestamp?: number;
      eventType: string;
      payloadHash?: string;
      processedAt?: number;
      receivedAt: number;
      _id: Id<"webhookEvents">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "eventId"
      | "eventTimestamp"
      | "eventType"
      | "payloadHash"
      | "processedAt"
      | "receivedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_event_id: ["eventId", "_creationTime"];
      by_received_at: ["receivedAt", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workItems: {
    document: {
      aiSummary?: string;
      assignee?: Id<"users">;
      conversationId?: Id<"conversations">;
      createdAt: number;
      customerId: Id<"customers">;
      dedupeKey?: string;
      dueAt?: number;
      evidenceLinks?: Array<{ id: string; label?: string; table: string }>;
      followUpProposal?: {
        dueAt?: number;
        note: string;
        proposedAt: number;
        proposedBy: Id<"users">;
      };
      organizationId: Id<"organizations">;
      priority: "low" | "medium" | "high" | "urgent";
      resolution?: string;
      sentiment?: string;
      slaDueAt?: number;
      sourceOutcomeId?: Id<"callOutcomes">;
      sourceProviderRunId?: string;
      sourceType?: string;
      status:
        | "open"
        | "assigned"
        | "investigating"
        | "waiting_for_customer"
        | "resolved";
      team?: string;
      type: "dispute" | "handoff" | "follow_up" | "escalation";
      updatedAt: number;
      _id: Id<"workItems">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "aiSummary"
      | "assignee"
      | "conversationId"
      | "createdAt"
      | "customerId"
      | "dedupeKey"
      | "dueAt"
      | "evidenceLinks"
      | "followUpProposal"
      | "followUpProposal.dueAt"
      | "followUpProposal.note"
      | "followUpProposal.proposedAt"
      | "followUpProposal.proposedBy"
      | "organizationId"
      | "priority"
      | "resolution"
      | "sentiment"
      | "slaDueAt"
      | "sourceOutcomeId"
      | "sourceProviderRunId"
      | "sourceType"
      | "status"
      | "team"
      | "type"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization_assignee: ["organizationId", "assignee", "_creationTime"];
      by_organization_customer: [
        "organizationId",
        "customerId",
        "_creationTime",
      ];
      by_organization_dedupe: ["organizationId", "dedupeKey", "_creationTime"];
      by_organization_due: ["organizationId", "dueAt", "_creationTime"];
      by_organization_status: ["organizationId", "status", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
  workspaceConfig: {
    document: {
      businessName: string;
      createdAt: number;
      crmSyncEnabled: boolean;
      leadAgentWorkflowId?: number;
      onboardingBusinessNamedAt?: number;
      onboardingDismissedAt?: number;
      onboardingStartedAt?: number;
      organizationId: Id<"organizations">;
      updatedAt: number;
      _id: Id<"workspaceConfig">;
      _creationTime: number;
    };
    fieldPaths:
      | "_creationTime"
      | "_id"
      | "businessName"
      | "createdAt"
      | "crmSyncEnabled"
      | "leadAgentWorkflowId"
      | "onboardingBusinessNamedAt"
      | "onboardingDismissedAt"
      | "onboardingStartedAt"
      | "organizationId"
      | "updatedAt";
    indexes: {
      by_id: ["_id"];
      by_creation_time: ["_creationTime"];
      by_organization: ["organizationId", "_creationTime"];
    };
    searchIndexes: {};
    vectorIndexes: {};
  };
};

/**
 * The names of all of your Convex tables.
 */
export type TableNames = TableNamesInDataModel<DataModel>;

/**
 * The type of a document stored in Convex.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Doc<TableName extends TableNames> = DocumentByName<
  DataModel,
  TableName
>;

/**
 * An identifier for a document in Convex.
 *
 * Convex documents are uniquely identified by their `Id`, which is accessible
 * on the `_id` field. To learn more, see [Document IDs](https://docs.convex.dev/using/document-ids).
 *
 * Documents can be loaded using `db.get(tableName, id)` in query and mutation functions.
 *
 * IDs are just strings at runtime, but this type can be used to distinguish them from other
 * strings when type checking.
 *
 * @typeParam TableName - A string literal type of the table name (like "users").
 */
export type Id<TableName extends TableNames | SystemTableNames> =
  GenericId<TableName>;
