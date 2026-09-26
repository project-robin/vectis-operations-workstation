import { internalMutation } from "./_generated/server";
import { v } from "convex/values";

/** Additive, bounded backfill for campaigns and members created by the draft schema. */
export const backfillTask8 = internalMutation({
  args: { batchSize: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const batchSize = args.batchSize ?? 100;
    if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("batchSize is invalid");
    const campaigns = await ctx.db.query("campaigns").withIndex("by_organization_updated").order("asc").take(batchSize);
    let campaignsUpdated = 0;
    for (const campaign of campaigns) {
      if (campaign.businessStatus !== undefined && campaign.providerExecutionState !== undefined) continue;
      const businessStatus = campaign.businessStatus ?? campaign.status ?? "draft";
      await ctx.db.patch(campaign._id, {
        businessStatus,
        providerExecutionState: campaign.providerExecutionState ?? campaign.providerState ?? (campaign.dograhCampaignId === undefined ? "not_created" : "unknown"),
        reconciliationRequired: campaign.reconciliationRequired ?? false,
        processedRows: campaign.processedRows ?? 0,
        failedRows: campaign.failedRows ?? 0,
        updatedAt: Date.now(),
      });
      campaignsUpdated += 1;
    }
    const members = await ctx.db.query("campaignMembers").withIndex("by_organization_campaign").order("asc").take(batchSize);
    let membersUpdated = 0;
    for (const member of members) {
      if (member.callDisposition !== undefined && member.workstationRunId !== undefined) continue;
      await ctx.db.patch(member._id, {
        callDisposition: member.callDisposition ?? (member.status === "processed" ? "completed" : "not_called"),
        workstationRunId: member.workstationRunId ?? `legacy:campaign:${member.campaignId}:customer:${member.customerId}`,
        updatedAt: Date.now(),
      });
      membersUpdated += 1;
    }
    return { campaignsUpdated, membersUpdated, hasMore: campaigns.length === batchSize || members.length === batchSize };
  },
});
