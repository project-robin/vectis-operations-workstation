import type { GenericId } from "convex/values";
import type { MutationCtx } from "../_generated/server";

export type PriorState = "missed" | "stale" | "no_show" | "overdue";
export const ATTRIBUTION_RULE_VERSION = "task9.v1";

export type AttributionInteraction = {
  id: string;
  customerId: string;
  opportunityId?: string;
  at: number;
  providerRunId?: string;
};

export type PriorStateEvidence = {
  state: PriorState;
  evidencedAt: number;
  sourceType: string;
  sourceExternalId: string;
  evidenceReference?: string;
};

export type AttributionSelection = {
  interactionId?: string;
  providerRunId?: string;
  influenced: boolean;
  recovered: boolean;
  rule: string;
  ruleVersion: string;
  confidence: number;
  explanation: string;
  priorStateEvidence?: PriorStateEvidence;
};

export function chooseAttribution(args: {
  factAt: number;
  customerId: string;
  opportunityId?: string;
  windowMs: number;
  interactions: AttributionInteraction[];
  priorStateEvidence?: PriorStateEvidence;
  recoveryWindowMs?: number;
  recoveryPriorStateTypes?: PriorState[];
}): AttributionSelection {
  const candidates = args.interactions
    .filter((row) => row.customerId === args.customerId)
    .filter((row) => args.opportunityId === undefined || row.opportunityId === undefined || row.opportunityId === args.opportunityId)
    .filter((row) => row.at <= args.factAt && args.factAt - row.at <= args.windowMs)
    .sort((a, b) => b.at - a.at || a.id.localeCompare(b.id));
  const interaction = candidates[0];
  if (!interaction) {
    return {
      influenced: false,
      recovered: false,
      rule: "unattributed",
      ruleVersion: ATTRIBUTION_RULE_VERSION,
      confidence: 0,
      explanation: "No eligible preceding Vectis interaction exists inside the organization attribution window.",
    };
  }

  const recoveryWindowMs = args.recoveryWindowMs ?? args.windowMs;
  const allowedStates = args.recoveryPriorStateTypes ?? ["missed", "stale", "no_show", "overdue"];
  const prior = args.priorStateEvidence;
  const recovered = Boolean(
    prior &&
      allowedStates.includes(prior.state) &&
      prior.evidencedAt < interaction.at &&
      prior.evidencedAt < args.factAt &&
      args.factAt - prior.evidencedAt <= recoveryWindowMs,
  );
  return {
    interactionId: interaction.id,
    providerRunId: interaction.providerRunId,
    influenced: true,
    recovered,
    rule: recovered ? `${prior!.state}_recovery` : "preceding_vectis_interaction",
    ruleVersion: ATTRIBUTION_RULE_VERSION,
    confidence: recovered ? 1 : 0.9,
    explanation: recovered
      ? `Attributed to the latest preceding Vectis interaction; prior ${prior!.state} evidence predates that interaction.`
      : "Attributed to the latest preceding Vectis interaction inside the configured window.",
    priorStateEvidence: recovered ? prior : undefined,
  };
}

/** Database seam retained for provider/internal callers. Selection itself is pure and inspectable. */
export async function attributeFact(ctx: MutationCtx, args: {
  organizationId: GenericId<"organizations">;
  customerId: GenericId<"customers">;
  opportunityId?: GenericId<"opportunities">;
  priorStateEvidence?: PriorStateEvidence;
  priorState?: PriorState;
  factAt?: number;
  now?: number;
}): Promise<AttributionSelection & { opportunityId?: GenericId<"opportunities">; interactionId?: GenericId<"interactions"> }> {
  const factAt = args.factAt ?? args.now ?? Date.now();
  const settings = await ctx.db.query("organizationSettings").withIndex("by_organization", (q) => q.eq("organizationId", args.organizationId)).take(2);
  if (settings.length > 1) throw new Error(`Integrity error: duplicate organization settings for ${args.organizationId}`);
  const policy = settings[0];
  if (!policy) throw new Error("Organization settings are not initialized");
  const windowMs = (policy.attributionWindow.unit === "days" ? policy.attributionWindow.value * 24 : policy.attributionWindow.value) * 60 * 60 * 1000;
  const interactions = await ctx.db.query("interactions").withIndex("by_organization_customer_time", (q) => q.eq("organizationId", args.organizationId).eq("customerId", args.customerId)).take(5000);
  const selection = chooseAttribution({
    factAt,
    customerId: args.customerId,
    opportunityId: args.opportunityId,
    windowMs,
    interactions: interactions.map((row) => ({ id: row._id, customerId: row.customerId, opportunityId: row.opportunityId, at: row.at, providerRunId: row.providerRunId })),
    priorStateEvidence: args.priorStateEvidence ?? (args.priorState ? { state: args.priorState, evidencedAt: factAt - 1, sourceType: "legacy", sourceExternalId: "legacy" } : undefined),
  });
  return { ...selection, opportunityId: args.opportunityId, interactionId: selection.interactionId as GenericId<"interactions"> | undefined };
}
