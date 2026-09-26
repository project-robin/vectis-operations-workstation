/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";
import type { GenericId as Id } from "convex/values";

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: {
  agents: {
    checkConnections: FunctionReference<"action", "public", {}, any>;
    list: FunctionReference<"action", "public", {}, any>;
  };
  analytics: {
    getAnalytics: FunctionReference<
      "query",
      "public",
      { endAt: number; startAt: number },
      any
    >;
    getCommercialDrilldown: FunctionReference<
      "query",
      "public",
      {
        drilldownId: string;
        endAt: number;
        paginationOpts: { cursor: string | null; numItems: number };
        startAt: number;
      },
      any
    >;
    getHomeSummary: FunctionReference<
      "query",
      "public",
      { endAt: number; startAt: number },
      any
    >;
    getPublicationReadiness: FunctionReference<"query", "public", {}, any>;
    getSummary: FunctionReference<
      "query",
      "public",
      { endAt: number; startAt: number },
      any
    >;
  };
  appointments: {
    listCustomerAppointments: FunctionReference<
      "query",
      "public",
      {
        customerId: Id<"customers">;
        includeHistory?: boolean;
        paginationOpts?: { cursor: string | null; numItems: number };
        status?:
          "requested" | "confirmed" | "cancelled" | "no_show" | "completed";
      },
      any
    >;
    recordAppointmentStatus: FunctionReference<
      "mutation",
      "public",
      {
        appointmentId: Id<"appointments">;
        correlationId?: string;
        note?: string;
        scheduledFor?: number;
        status:
          "requested" | "confirmed" | "cancelled" | "no_show" | "completed";
      },
      any
    >;
    requestAppointment: FunctionReference<
      "mutation",
      "public",
      {
        bindingId?: Id<"integrationBindings">;
        conversationId?: Id<"conversations">;
        correlationId?: string;
        customerId: Id<"customers">;
        note?: string;
        opportunityId?: Id<"opportunities">;
        outcomeId?: Id<"callOutcomes">;
        scheduledFor?: number;
        sourceExternalId?: string;
        sourceType?: string;
        title?: string;
      },
      any
    >;
  };
  calls: {
    batches: FunctionReference<"query", "public", {}, any>;
    callingAnalytics: FunctionReference<
      "query",
      "public",
      { endAt: number; startAt: number },
      any
    >;
    callLeads: FunctionReference<
      "mutation",
      "public",
      { leadIds?: Array<Id<"leads">>; name?: string },
      any
    >;
    dashboard: FunctionReference<"query", "public", {}, any>;
    get: FunctionReference<"query", "public", { callId: string }, any>;
    list: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
      },
      any
    >;
    refreshNow: FunctionReference<
      "mutation",
      "public",
      { callId: Id<"calls"> },
      any
    >;
    retryCrmSync: FunctionReference<
      "mutation",
      "public",
      { callId: Id<"calls"> },
      any
    >;
    startQuickCall: FunctionReference<
      "mutation",
      "public",
      { brief: string; contactName?: string; phone: string },
      any
    >;
  };
  campaigns: {
    approveCampaign: FunctionReference<
      "mutation",
      "public",
      { campaignId: Id<"campaigns">; correlationId?: string },
      any
    >;
    createCampaignDraft: FunctionReference<
      "mutation",
      "public",
      {
        batchId: Id<"importBatches">;
        bindingId: Id<"integrationBindings">;
        idempotencyKey: string;
        name: string;
      },
      any
    >;
    getCampaign: FunctionReference<
      "query",
      "public",
      { campaignId: Id<"campaigns"> },
      any
    >;
    listCampaigns: FunctionReference<
      "query",
      "public",
      { paginationOpts?: { cursor: string | null; numItems: number } },
      any
    >;
    pauseCampaign: FunctionReference<
      "mutation",
      "public",
      { campaignId: Id<"campaigns">; idempotencyKey: string },
      any
    >;
    reconcileCampaign: FunctionReference<
      "mutation",
      "public",
      {
        campaignId: Id<"campaigns">;
        decision: "retry" | "confirm" | "fail";
        reason: string;
      },
      any
    >;
    resumeCampaign: FunctionReference<
      "mutation",
      "public",
      { campaignId: Id<"campaigns">; idempotencyKey: string },
      any
    >;
    startCampaign: FunctionReference<
      "mutation",
      "public",
      { campaignId: Id<"campaigns">; idempotencyKey: string },
      any
    >;
  };
  commercialOutcomes: {
    get: FunctionReference<
      "query",
      "public",
      { commercialOutcomeId: Id<"commercialOutcomes"> },
      any
    >;
    getAttribution: FunctionReference<
      "query",
      "public",
      { commercialOutcomeId: Id<"commercialOutcomes"> },
      any
    >;
    ingest: FunctionReference<
      "mutation",
      "public",
      {
        amountMinor?: number;
        authoritativeExternalId?: string;
        confidence?: number;
        coverageState: "verified" | "partial" | "unverified" | "unknown";
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
        priorStateEvidence?: {
          evidenceReference?: string;
          evidencedAt: number;
          sourceExternalId: string;
          sourceType: string;
          state: "missed" | "stale" | "no_show" | "overdue";
        };
        providerRunId?: string;
        readbackEvidence?: string;
        sourceExternalId: string;
        sourceType: string;
        status: "estimated" | "confirmed" | "collected";
        verifiedAt?: number;
      },
      any
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        endAt?: number;
        paginationOpts: { cursor: string | null; numItems: number };
        startAt?: number;
        status?: "estimated" | "confirmed" | "collected";
      },
      any
    >;
    recordShadowComparison: FunctionReference<
      "mutation",
      "public",
      {
        comparedAt: number;
        detail?: string;
        discrepancyCount: number;
        missingCurrency: boolean;
        policyComplete: boolean;
        sourceMappingVerified: boolean;
        sourceType: string;
        staleEvidence: boolean;
      },
      any
    >;
  };
  conversations: {
    listCustomerConversations: FunctionReference<
      "query",
      "public",
      {
        customerId: Id<"customers">;
        paginationOpts?: { cursor: string | null; numItems: number };
      },
      any
    >;
    listRecentConversations: FunctionReference<
      "query",
      "public",
      {
        limit?: number;
        paginationOpts?: { cursor: string | null; numItems: number };
      },
      any
    >;
  };
  customers: {
    createCustomer: FunctionReference<
      "mutation",
      "public",
      { displayName: string; email?: string; phone?: string },
      any
    >;
    getCustomer: FunctionReference<
      "query",
      "public",
      {
        customerId: Id<"customers">;
        paginationOpts?: { cursor: string | null; numItems: number };
      },
      any
    >;
    listCustomers: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: { cursor: string | null; numItems: number };
        search?: string;
      },
      any
    >;
    listIdentityReviews: FunctionReference<
      "query",
      "public",
      { paginationOpts: { cursor: string | null; numItems: number } },
      any
    >;
    mergeCustomers: FunctionReference<
      "mutation",
      "public",
      { sourceCustomerId: Id<"customers">; targetCustomerId: Id<"customers"> },
      any
    >;
    resolveIdentityReview: FunctionReference<
      "mutation",
      "public",
      { customerId: Id<"customers">; reviewId: Id<"identityReviewItems"> },
      any
    >;
  };
  customerTimeline: {
    getCustomerTimeline: FunctionReference<
      "query",
      "public",
      {
        customerId: Id<"customers">;
        paginationOpts?: { cursor: string | null; numItems: number };
      },
      any
    >;
  };
  deliveries: {
    getDelivery: FunctionReference<
      "query",
      "public",
      { deliveryId: Id<"deliveries"> },
      any
    >;
    listDeliveries: FunctionReference<
      "query",
      "public",
      {
        paginationOpts?: { cursor: string | null; numItems: number };
        status?:
          | "pending"
          | "claimed"
          | "succeeded"
          | "failed"
          | "ambiguous"
          | "reconciliation_required";
      },
      any
    >;
    reconcileDelivery: FunctionReference<
      "mutation",
      "public",
      {
        action: "retry" | "succeeded" | "failed";
        correlationId?: string;
        deliveryId: Id<"deliveries">;
        externalIds?: Array<string>;
        readbackEvidence?: string;
      },
      any
    >;
    reserveDeliveryIntent: FunctionReference<
      "mutation",
      "public",
      {
        bindingId?: Id<"integrationBindings">;
        bindingKey?: string;
        correlationId?: string;
        customerId?: Id<"customers">;
        idempotencyKey: string;
        maxAttempts?: number;
        payload: string;
        payloadVersion?: number;
        providerRunId?: string;
        target:
          | "twenty_person"
          | "twenty_note"
          | "twenty_task"
          | "twenty_appointment";
      },
      any
    >;
  };
  imports: {
    approveBatch: FunctionReference<
      "mutation",
      "public",
      { batchId: Id<"importBatches"> },
      any
    >;
    commitBatch: FunctionReference<
      "mutation",
      "public",
      { batchId: Id<"importBatches"> },
      any
    >;
    finalizeArtifact: FunctionReference<
      "mutation",
      "public",
      {
        filename: string;
        mimeType: string;
        sha256: string;
        storageId: Id<"_storage">;
      },
      any
    >;
    generateArtifactUploadUrl: FunctionReference<"mutation", "public", {}, any>;
    getArtifact: FunctionReference<
      "query",
      "public",
      { artifactId: Id<"sourceArtifacts"> },
      any
    >;
    getArtifactUrl: FunctionReference<
      "query",
      "public",
      { artifactId: Id<"sourceArtifacts"> },
      any
    >;
    listEligibleRows: FunctionReference<
      "query",
      "public",
      {
        batchId: Id<"importBatches">;
        paginationOpts: { cursor: string | null; numItems: number };
      },
      any
    >;
    listImportBatches: FunctionReference<"query", "public", {}, any>;
    stageImport: FunctionReference<
      "mutation",
      "public",
      {
        artifactId?: Id<"sourceArtifacts">;
        mappingVersion?: string;
        name: string;
        rows: Array<{
          consent: "consented" | "unconsented" | "unknown";
          consentSource?: string;
          email?: string;
          evidenceAt?: number;
          name?: string;
          phone?: string;
        }>;
      },
      any
    >;
  };
  integrationBindings: {
    get: FunctionReference<
      "query",
      "public",
      { bindingId: Id<"integrationBindings"> },
      any
    >;
    list: FunctionReference<"query", "public", {}, any>;
    remove: FunctionReference<
      "mutation",
      "public",
      { bindingId: Id<"integrationBindings">; correlationId?: string },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        bindingId?: Id<"integrationBindings">;
        bindingKey?: string;
        correlationId?: string;
        dograhOrganizationId?: string;
        dograhWorkflowId?: string;
        health?: {
          detail?: string;
          lastCheckedAt?: number;
          nextCheckAt?: number;
          status: "healthy" | "degraded" | "unhealthy" | "unknown";
        };
        metadata?: Array<{ key: string; value: string }>;
        provider?: "dograh" | "twenty" | "hermes";
        secretReferenceNames?: Array<string>;
        status?: "active" | "inactive";
        twentyObjectMappings?: Array<{
          twentyObject: string;
          workstationType: string;
        }>;
        twentyWorkspaceId?: string;
      },
      any
    >;
    upsert: FunctionReference<
      "mutation",
      "public",
      {
        bindingId?: Id<"integrationBindings">;
        bindingKey?: string;
        correlationId?: string;
        dograhOrganizationId?: string;
        dograhWorkflowId?: string;
        health?: {
          detail?: string;
          lastCheckedAt?: number;
          nextCheckAt?: number;
          status: "healthy" | "degraded" | "unhealthy" | "unknown";
        };
        metadata?: Array<{ key: string; value: string }>;
        provider?: "dograh" | "twenty" | "hermes";
        secretReferenceNames?: Array<string>;
        status?: "active" | "inactive";
        twentyObjectMappings?: Array<{
          twentyObject: string;
          workstationType: string;
        }>;
        twentyWorkspaceId?: string;
      },
      any
    >;
  };
  leads: {
    importFromTwenty: FunctionReference<"action", "public", {}, any>;
    importRows: FunctionReference<
      "mutation",
      "public",
      {
        rows: Array<{
          email?: string;
          name: string;
          notes?: string;
          phone: string;
          twentyPersonId?: string;
        }>;
        source: "csv" | "twenty" | "manual";
      },
      any
    >;
    list: FunctionReference<
      "query",
      "public",
      {
        paginationOpts: {
          cursor: string | null;
          endCursor?: string | null;
          id?: number;
          maximumBytesRead?: number;
          maximumRowsRead?: number;
          numItems: number;
        };
        status?: "new" | "queued" | "called" | "failed";
      },
      any
    >;
    remove: FunctionReference<
      "mutation",
      "public",
      { leadId: Id<"leads"> },
      any
    >;
    stats: FunctionReference<"query", "public", {}, any>;
  };
  opportunities: {
    createOpportunity: FunctionReference<
      "mutation",
      "public",
      {
        currency?: string;
        customerId: Id<"customers">;
        expectedValueMinor?: number;
        ownerOverride?: boolean;
        sourcePursuitId: string;
        sourceRowId?: Id<"importRows">;
        sourceType: string;
        stage: string;
        title: string;
      },
      any
    >;
    getOpportunity: FunctionReference<
      "query",
      "public",
      { opportunityId: Id<"opportunities"> },
      any
    >;
    listOpportunities: FunctionReference<
      "query",
      "public",
      {
        customerId?: Id<"customers">;
        paginationOpts: { cursor: string | null; numItems: number };
      },
      any
    >;
    updateOpportunity: FunctionReference<
      "mutation",
      "public",
      {
        currency?: string;
        expectedValueMinor?: number;
        opportunityId: Id<"opportunities">;
        stage?: string;
        status?: "open" | "won" | "lost";
        terminalOutcome?: string;
        title?: string;
      },
      any
    >;
  };
  organizations: {
    addMember: FunctionReference<
      "mutation",
      "public",
      { clerkId: string; role: "owner" | "operator" | "staff" },
      any
    >;
    getCurrent: FunctionReference<"query", "public", {}, any>;
  };
  organizationSettings: {
    getCurrent: FunctionReference<"query", "public", {}, any>;
    initializeDefaults: FunctionReference<"mutation", "public", {}, any>;
    publishCommercialMetrics: FunctionReference<
      "mutation",
      "public",
      { correlationId?: string },
      any
    >;
    update: FunctionReference<
      "mutation",
      "public",
      {
        attributionWindow?: {
          semantics: "interaction_to_outcome";
          unit: "hours" | "days";
          value: number;
        };
        bookingAuthorityPolicy?: {
          requireReadback: boolean;
          sourceType: string;
        };
        businessVertical?: string;
        commercialMetricsMode?: "shadow" | "published";
        correlationId?: string;
        defaultCurrency?: string;
        expectedBookingValuePolicy?: {
          amountMinor?: number;
          currency?: string;
          mode: "none" | "org_wide" | "service" | "opportunity";
          serviceValues?: Array<{
            amountMinor: number;
            currency: string;
            service: string;
          }>;
        };
        healthFreshnessPolicy?: {
          criticalAfterMinutes: number;
          warningAfterMinutes: number;
        };
        paymentAuthorityPolicy?: {
          requireReadback: boolean;
          sourceTypes: Array<string>;
        };
        recoveryPolicy?: {
          enabled: boolean;
          priorStateTypes: Array<"missed" | "stale" | "no_show" | "overdue">;
          window: { unit: "hours" | "days"; value: number };
        };
        timezone?: string;
      },
      any
    >;
  };
  toolchain: {
    probeCount: FunctionReference<"query", "public", {}, any>;
    recordProbe: FunctionReference<
      "mutation",
      "public",
      { label: string },
      any
    >;
    removeProbe: FunctionReference<
      "mutation",
      "public",
      { probeId: Id<"toolchainProbes"> },
      any
    >;
    scheduleEcho: FunctionReference<
      "mutation",
      "public",
      { payload: string },
      any
    >;
  };
  users: {
    getCurrent: FunctionReference<"query", "public", {}, any>;
  };
  workItems: {
    assignWorkItem: FunctionReference<
      "mutation",
      "public",
      {
        assignee: Id<"users">;
        correlationId?: string;
        workItemId: Id<"workItems">;
      },
      any
    >;
    createWorkItem: FunctionReference<
      "mutation",
      "public",
      {
        aiSummary?: string;
        assignee?: Id<"users">;
        conversationId?: Id<"conversations">;
        correlationId?: string;
        customerId: Id<"customers">;
        dedupeKey?: string;
        dueAt?: number;
        evidenceLinks?: Array<{ id: string; label?: string; table: string }>;
        priority?: "low" | "medium" | "high" | "urgent";
        sentiment?: string;
        slaDueAt?: number;
        team?: string;
        type: "dispute" | "handoff" | "follow_up" | "escalation";
      },
      any
    >;
    getWorkItem: FunctionReference<
      "query",
      "public",
      { workItemId: Id<"workItems"> },
      any
    >;
    listWorkItems: FunctionReference<
      "query",
      "public",
      {
        assignee?: Id<"users">;
        customerId?: Id<"customers">;
        dueBefore?: number;
        paginationOpts?: { cursor: string | null; numItems: number };
        status?:
          | "open"
          | "assigned"
          | "investigating"
          | "waiting_for_customer"
          | "resolved";
      },
      any
    >;
    setWorkItemStatus: FunctionReference<
      "mutation",
      "public",
      {
        correlationId?: string;
        followUpProposal?: { dueAt?: number; note: string };
        resolution?: string;
        status:
          | "open"
          | "assigned"
          | "investigating"
          | "waiting_for_customer"
          | "resolved";
        workItemId: Id<"workItems">;
      },
      any
    >;
    updateWorkItem: FunctionReference<
      "mutation",
      "public",
      {
        aiSummary?: string;
        correlationId?: string;
        dueAt?: number;
        evidenceLinks?: Array<{ id: string; label?: string; table: string }>;
        priority?: "low" | "medium" | "high" | "urgent";
        sentiment?: string;
        slaDueAt?: number;
        team?: string;
        workItemId: Id<"workItems">;
      },
      any
    >;
  };
  workspace: {
    current: FunctionReference<"query", "public", {}, any>;
    dismissOnboarding: FunctionReference<"mutation", "public", {}, any>;
    ensureWorkspace: FunctionReference<"mutation", "public", {}, any>;
    updateSettings: FunctionReference<
      "mutation",
      "public",
      {
        businessName?: string;
        crmSyncEnabled?: boolean;
        leadAgentWorkflowId?: number | null;
      },
      any
    >;
  };
};

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: {
  actions: {
    dograh: {
      executeTransition: FunctionReference<
        "action",
        "internal",
        {
          campaignId: Id<"campaigns">;
          claimToken: string;
          operation: "start" | "pause" | "resume";
        },
        any
      >;
      reconcile: FunctionReference<
        "action",
        "internal",
        { campaignId: Id<"campaigns"> },
        any
      >;
    };
    twenty: {
      deliver: FunctionReference<
        "action",
        "internal",
        { deliveryId: Id<"deliveries"> },
        any
      >;
      readOpportunities: FunctionReference<
        "action",
        "internal",
        {
          bindingKey?: string;
          organizationId: Id<"organizations">;
          query: string;
        },
        any
      >;
      readPayments: FunctionReference<
        "action",
        "internal",
        {
          bindingKey?: string;
          organizationId: Id<"organizations">;
          query: string;
        },
        any
      >;
    };
  };
  appointments: {
    confirmFromReadback: FunctionReference<
      "mutation",
      "internal",
      {
        appointmentId: Id<"appointments">;
        bindingId?: Id<"integrationBindings">;
        externalId: string;
        now: number;
        readbackEvidence: string;
      },
      any
    >;
    projectFromOutcome: FunctionReference<
      "mutation",
      "internal",
      { organizationId: Id<"organizations">; outcomeId: Id<"callOutcomes"> },
      any
    >;
  };
  calls: {
    activeCalls: FunctionReference<"query", "internal", {}, any>;
    applyResult: FunctionReference<
      "mutation",
      "internal",
      {
        answers?: string;
        callId: Id<"calls">;
        disposition?: string;
        durationSeconds?: number;
        error?: string;
        extracted?: string;
        followUpRequired?: boolean;
        recordingUrl?: string;
        status: "completed" | "no_answer" | "failed";
        summary?: string;
        transcript?: string;
        transcriptUrl?: string;
      },
      any
    >;
    attachRun: FunctionReference<
      "mutation",
      "internal",
      { callId: Id<"calls">; runId: number; runName?: string },
      any
    >;
    batchCreated: FunctionReference<
      "mutation",
      "internal",
      { batchId: Id<"callBatches">; campaignId: number },
      any
    >;
    batchFailed: FunctionReference<
      "mutation",
      "internal",
      { batchId: Id<"callBatches">; error: string },
      any
    >;
    batchForDispatch: FunctionReference<
      "query",
      "internal",
      { batchId: Id<"callBatches"> },
      any
    >;
    batchStarted: FunctionReference<
      "mutation",
      "internal",
      { batchId: Id<"callBatches"> },
      any
    >;
    claimCrm: FunctionReference<
      "mutation",
      "internal",
      { callId: Id<"calls"> },
      any
    >;
    crmFinished: FunctionReference<
      "mutation",
      "internal",
      {
        callId: Id<"calls">;
        error?: string;
        noteId?: string;
        personId?: string;
      },
      any
    >;
    dispatchBatch: FunctionReference<
      "action",
      "internal",
      { batchId: Id<"callBatches"> },
      any
    >;
    dispatchQuickCall: FunctionReference<
      "action",
      "internal",
      { callId: Id<"calls"> },
      any
    >;
    findForWebhook: FunctionReference<
      "query",
      "internal",
      { runId?: number; vectisCallId?: string },
      any
    >;
    handleWebhook: FunctionReference<
      "action",
      "internal",
      { runId?: number; vectisCallId?: string },
      any
    >;
    markDispatched: FunctionReference<
      "mutation",
      "internal",
      { callId: Id<"calls">; runId?: number; runName?: string },
      any
    >;
    markFailed: FunctionReference<
      "mutation",
      "internal",
      { callId: Id<"calls">; error: string },
      any
    >;
    pollActiveCalls: FunctionReference<"action", "internal", {}, any>;
    quickCallForDispatch: FunctionReference<
      "query",
      "internal",
      { callId: Id<"calls"> },
      any
    >;
    syncToCrm: FunctionReference<
      "action",
      "internal",
      { callId: Id<"calls"> },
      any
    >;
    touch: FunctionReference<
      "mutation",
      "internal",
      { callId: Id<"calls"> },
      any
    >;
  };
  campaigns: {
    actionContext: FunctionReference<
      "query",
      "internal",
      { campaignId: Id<"campaigns">; claimToken?: string },
      any
    >;
    applyReconciliation: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        evidence: string;
        failedRows: number;
        processedRows: number;
        providerState: string;
        runs?: string;
        totalRows: number;
      },
      any
    >;
    completeTransition: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        claimToken: string;
        operation: "start" | "pause" | "resume";
        providerState: string;
      },
      any
    >;
    failTransition: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        claimToken: string;
        error: string;
        operation: "start" | "pause" | "resume";
      },
      any
    >;
    markPollReconciliationRequired: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        category:
          "provider" | "timeout" | "transport" | "malformed" | "reconciliation";
        error: string;
      },
      any
    >;
    markReconciliationRequired: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        category:
          "provider" | "timeout" | "transport" | "malformed" | "reconciliation";
        claimToken: string;
        error: string;
        operation: "start" | "pause" | "resume";
      },
      any
    >;
    reconcileCandidates: FunctionReference<
      "query",
      "internal",
      { batchSize: number },
      any
    >;
    recordProviderCampaign: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId: Id<"campaigns">;
        claimToken: string;
        providerCampaignId: number;
        providerState: string;
      },
      any
    >;
    sweepReconciliation: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number },
      any
    >;
  };
  commercialOutcomes: {
    ingestInternal: FunctionReference<
      "mutation",
      "internal",
      {
        amountMinor?: number;
        authoritativeExternalId?: string;
        confidence?: number;
        coverageState: "verified" | "partial" | "unverified" | "unknown";
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
        priorStateEvidence?: {
          evidenceReference?: string;
          evidencedAt: number;
          sourceExternalId: string;
          sourceType: string;
          state: "missed" | "stale" | "no_show" | "overdue";
        };
        providerRunId?: string;
        readbackEvidence?: string;
        sourceExternalId: string;
        sourceType: string;
        status: "estimated" | "confirmed" | "collected";
        verifiedAt?: number;
      },
      any
    >;
  };
  deliveries: {
    claim: FunctionReference<
      "mutation",
      "internal",
      { deliveryId: Id<"deliveries">; leaseMs?: number; now?: number },
      any
    >;
    finish: FunctionReference<
      "mutation",
      "internal",
      {
        ambiguous?: boolean;
        deliveryId: Id<"deliveries">;
        error?: string;
        externalIds?: Array<string>;
        leaseToken: string;
        now: number;
        ok: boolean;
        readbackEvidence?: string;
      },
      any
    >;
    reconcile: FunctionReference<
      "mutation",
      "internal",
      {
        action: "retry" | "succeeded" | "failed";
        deliveryId: Id<"deliveries">;
        externalIds?: Array<string>;
        now: number;
        readbackEvidence?: string;
      },
      any
    >;
    reserve: FunctionReference<
      "mutation",
      "internal",
      {
        bindingId?: Id<"integrationBindings">;
        bindingKey?: string;
        customerId?: Id<"customers">;
        idempotencyKey: string;
        maxAttempts?: number;
        now?: number;
        organizationId: Id<"organizations">;
        payload: string;
        payloadVersion?: number;
        providerRunId?: string;
        target:
          | "twenty_person"
          | "twenty_note"
          | "twenty_task"
          | "twenty_appointment";
      },
      any
    >;
    retryDue: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number; now: number; organizationId: Id<"organizations"> },
      any
    >;
    sweepDue: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number; now?: number },
      any
    >;
  };
  dograhCallback: {
    ingest: FunctionReference<
      "mutation",
      "internal",
      {
        callbackAt?: number;
        campaignId?: Id<"campaigns">;
        customerId?: Id<"customers">;
        direction: "inbound" | "outbound";
        durationMs?: number;
        endedAt?: number;
        gatheredContext?: string;
        now: number;
        organizationId: Id<"organizations">;
        providerCampaignId?: number;
        providerRunId: string;
        providerWorkflowId?: number;
        recordingUrl?: string;
        sequenceNumber?: number;
        startedAt?: number;
        state: string;
        transcriptUrl?: string;
        workstationRunId: string;
      },
      any
    >;
  };
  http: {
    clerkWebhook: {
      cleanupRetention: FunctionReference<
        "mutation",
        "internal",
        { now?: number },
        any
      >;
      continueRetentionCleanup: FunctionReference<
        "mutation",
        "internal",
        { before: number },
        any
      >;
      processEvent: FunctionReference<
        "mutation",
        "internal",
        {
          eventId: string;
          eventTimestamp: number;
          eventType: string;
          payload: string;
        },
        any
      >;
    };
  };
  integrationBindings: {
    resolve: FunctionReference<
      "query",
      "internal",
      { bindingKey: string; organizationId: Id<"organizations"> },
      any
    >;
    resolveByKey: FunctionReference<
      "query",
      "internal",
      { bindingKey: string; organizationId: Id<"organizations"> },
      any
    >;
  };
  nodeActions: {
    fetchText: FunctionReference<
      "action",
      "internal",
      { target: "synthetic" },
      any
    >;
  };
  providerRuns: {
    lookupByWorkstationId: FunctionReference<
      "query",
      "internal",
      { workstationRunId: string },
      any
    >;
    register: FunctionReference<
      "mutation",
      "internal",
      {
        campaignId?: Id<"campaigns">;
        customerId: Id<"customers">;
        direction: "inbound" | "outbound";
        organizationId: Id<"organizations">;
        providerCampaignId?: number;
        providerRunId?: string;
        providerWorkflowId?: number;
        workstationRunId: string;
      },
      any
    >;
  };
  task8Migration: {
    backfillTask8: FunctionReference<
      "mutation",
      "internal",
      { batchSize?: number },
      any
    >;
  };
  toolchain: {
    continueCleanup: FunctionReference<
      "mutation",
      "internal",
      { organizationId: Id<"organizations"> },
      any
    >;
    echoAction: FunctionReference<
      "action",
      "internal",
      {
        organizationId: Id<"organizations">;
        payload: string;
        scheduleId: Id<"scheduledEchoes">;
      },
      any
    >;
    finalizeSchedule: FunctionReference<
      "mutation",
      "internal",
      {
        organizationId: Id<"organizations">;
        scheduleId: Id<"scheduledEchoes">;
        status: "completed" | "failed";
      },
      any
    >;
    recordEcho: FunctionReference<
      "mutation",
      "internal",
      { organizationId: Id<"organizations">; payload: string },
      any
    >;
    sweep: FunctionReference<"mutation", "internal", {}, any>;
  };
  workItems: {
    projectFromOutcome: FunctionReference<
      "mutation",
      "internal",
      { organizationId: Id<"organizations">; outcomeId: Id<"callOutcomes"> },
      any
    >;
  };
};

export declare const components: {};
