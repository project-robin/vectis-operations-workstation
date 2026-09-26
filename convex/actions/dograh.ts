"use node";

import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { DograhAdapter, DograhAmbiguousError, DograhError } from "../lib/dograhAdapter";
import { buildCampaignCsv, providerStateIsTerminal } from "../lib/campaignState";

const transition = v.union(v.literal("start"), v.literal("pause"), v.literal("resume"));
function secretFor(binding: { secretReferenceNames?: string[] } | null) {
  const reference = binding?.secretReferenceNames?.find((name) => /^[A-Z][A-Z0-9_]{1,127}$/.test(name));
  if (!reference) throw new Error("Dograh API key secret reference is not configured");
  const value = process.env[reference];
  if (!value) throw new Error("Dograh API key secret is unavailable");
  return value;
}
function errorCategory(error: unknown): "provider" | "timeout" | "transport" | "malformed" | "reconciliation" {
  if (error instanceof DograhAmbiguousError) {
    const cause = String(error.cause ?? "");
    if (/timeout|abort/i.test(cause)) return "timeout";
    if (/malformed|json/i.test(cause)) return "malformed";
    if (/fetch|network|connection/i.test(cause)) return "transport";
  }
  if (error instanceof DograhError && error.ambiguous) return "provider";
  return "provider";
}
function message(error: unknown) { return error instanceof Error ? error.message : "Dograh action failed"; }
function needsReconciliation(error: unknown) {
  if (error instanceof DograhAmbiguousError) return true;
  if (error instanceof DograhError && (error.ambiguous || (error.status !== undefined && error.status >= 500))) return true;
  return /malformed|transport|timeout|timed out|read-back|connection reset/i.test(message(error));
}

export const executeTransition = internalAction({
  args: { campaignId: v.id("campaigns"), operation: transition, claimToken: v.string() },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.campaigns.actionContext, { campaignId: args.campaignId, claimToken: args.claimToken });
    if (!context) return { skipped: true };
    try {
      const binding = context.binding;
      if (!binding || !context.campaign.providerWorkflowId || !context.campaign.providerOrganizationId) throw new Error("Dograh binding is incomplete");
      const adapter = new DograhAdapter(process.env.DOGRAH_API_URL ?? "", secretFor(binding));
      const canary = await adapter.canary(context.campaign.providerWorkflowId);
      if (!canary.workflow.active || canary.workflow.workflowId !== context.campaign.providerWorkflowId) throw new Error("Dograh workflow canary failed");
      let providerCampaignId = context.campaign.dograhCampaignId;
      if (args.operation === "start" && providerCampaignId === undefined) {
        const members = (context.members as Array<{ workstationRunId: string; consent?: string; sourceImportRowId?: string; sourceRowId?: string }>).map((member, index: number) => {
          const customer = (context.customers as Array<{ displayName: string; phone?: string } | null>)[index];
          if (!customer || member.consent !== "consented" || !member.sourceImportRowId) throw new Error("Campaign member is not eligible for upload");
          return { workstationRunId: member.workstationRunId, sourceRowId: String(member.sourceImportRowId), name: customer.displayName, phone: customer.phone ?? "", consent: "consented" as const };
        });
        const csv = buildCampaignCsv(members);
        const upload = await adapter.requestUploadUrl({ fileName: `campaign-${args.campaignId}.csv`, fileSize: new TextEncoder().encode(csv).byteLength });
        await adapter.uploadCsv(upload.uploadUrl, csv);
        const created = await adapter.create({ name: context.campaign.name, workflowId: Number(context.campaign.providerWorkflowId), fileKey: upload.fileKey, dograhOrganizationId: context.campaign.providerOrganizationId });
        providerCampaignId = created.campaignId;
        await ctx.runMutation(internal.campaigns.recordProviderCampaign, { campaignId: args.campaignId, claimToken: args.claimToken, providerCampaignId, providerState: created.state });
        const createdReadback = await adapter.get(providerCampaignId);
        await ctx.runMutation(internal.campaigns.recordProviderCampaign, { campaignId: args.campaignId, claimToken: args.claimToken, providerCampaignId, providerState: createdReadback.state });
      }
      if (providerCampaignId === undefined) throw new Error("Provider campaign ID is missing");
      let result = await adapter.get(providerCampaignId);
      if ((args.operation === "start" && result.state.toLowerCase() !== "running") || (args.operation === "pause" && result.state.toLowerCase() !== "paused") || (args.operation === "resume" && result.state.toLowerCase() !== "running")) {
        result = args.operation === "start" ? await adapter.start(providerCampaignId) : args.operation === "pause" ? await adapter.pause(providerCampaignId) : await adapter.resume(providerCampaignId);
        result = await adapter.get(providerCampaignId);
      }
      const expectedState = args.operation === "pause" ? "paused" : "running";
      if (!(args.operation === "start" && providerStateIsTerminal(result.state)) && result.state.toLowerCase() !== expectedState) throw new DograhAmbiguousError(args.operation, new Error(`Dograh read-back state was ${result.state}`));
      await ctx.runMutation(internal.campaigns.completeTransition, { campaignId: args.campaignId, claimToken: args.claimToken, operation: args.operation, providerState: result.state });
      return { skipped: false, providerCampaignId, state: result.state };
    } catch (error) {
      const category = errorCategory(error);
      if (needsReconciliation(error)) {
        await ctx.runMutation(internal.campaigns.markReconciliationRequired, { campaignId: args.campaignId, claimToken: args.claimToken, operation: args.operation, error: message(error), category });
      } else {
        await ctx.runMutation(internal.campaigns.failTransition, { campaignId: args.campaignId, claimToken: args.claimToken, operation: args.operation, error: message(error) });
      }
      return { skipped: false, error: message(error), reconciliationRequired: needsReconciliation(error) };
    }
  },
});

export const reconcile = internalAction({
  args: { campaignId: v.id("campaigns") },
  handler: async (ctx, args) => {
    const context = await ctx.runQuery(internal.campaigns.actionContext, { campaignId: args.campaignId });
    if (!context?.binding || context.campaign.dograhCampaignId === undefined || !context.campaign.providerWorkflowId) return { skipped: true };
    try {
      const adapter = new DograhAdapter(process.env.DOGRAH_API_URL ?? "", secretFor(context.binding));
      const [detail, progress, runs, report] = await Promise.all([
        adapter.get(context.campaign.dograhCampaignId),
        adapter.progress(context.campaign.dograhCampaignId),
        adapter.runs(context.campaign.dograhCampaignId),
        adapter.report(context.campaign.dograhCampaignId),
      ]);
      await ctx.runMutation(internal.campaigns.applyReconciliation, {
        campaignId: args.campaignId, providerState: detail.state, totalRows: progress.totalRows, processedRows: progress.processedRows, failedRows: progress.failedCalls,
        evidence: JSON.stringify({ detail, progress, runs: runs.slice(0, 500), report }), runs: JSON.stringify(runs.slice(0, 500)),
      });
      return { skipped: false, state: detail.state, runs: runs.length };
    } catch (error) {
      await ctx.runMutation(internal.campaigns.markPollReconciliationRequired, { campaignId: args.campaignId, error: message(error), category: errorCategory(error) === "provider" ? "reconciliation" : errorCategory(error) });
      return { skipped: false, reconciliationRequired: true, error: message(error) };
    }
  },
});

void secretFor;
void errorCategory;
void message;
