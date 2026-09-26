"use node";

import { internalAction } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { createRecordAndReadBack, deliveryObjectName, readRecords } from "../lib/twentyAdapter";

function bindingUrl(binding: { metadata?: Array<{ key: string; value: string }> }) {
  return binding.metadata?.find((entry) => ["mcpUrl", "serverUrl", "twentyMcpUrl"].includes(entry.key))?.value;
}

export const deliver = internalAction({
  args: { deliveryId: v.id("deliveries") },
  handler: async (ctx, args) => {
    const claimed = await ctx.runMutation(internal.deliveries.claim, { deliveryId: args.deliveryId });
    if (!claimed) return { skipped: true };
    const fail = async (error: string, ambiguous?: boolean) => ctx.runMutation(internal.deliveries.finish, { deliveryId: args.deliveryId, leaseToken: claimed.leaseToken, ok: false, error, ambiguous, now: Date.now() });
    try {
      const binding = await ctx.runQuery(internal.integrationBindings.resolve, { organizationId: claimed.organizationId, bindingKey: claimed.bindingKey ?? "twenty-primary" });
      if (!binding || (claimed.bindingId && binding._id !== claimed.bindingId)) { await fail("No active Twenty integration binding"); return { skipped: false, ok: false, error: "No active Twenty integration binding" }; }
      const serverUrl = bindingUrl(binding);
      const secretReference = binding.secretReferenceNames?.find((name: string) => name === "TWENTY_MCP_API_KEY") ?? binding.secretReferenceNames?.[0];
      const apiKey = secretReference ? process.env[secretReference] : undefined;
      if (!serverUrl || !secretReference || !apiKey) { await fail("Twenty binding is missing URL or deployment secret reference"); return { skipped: false, ok: false, error: "Twenty binding is missing URL or deployment secret reference" }; }
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(claimed.payload) as Record<string, unknown>; } catch (error) { await fail(`bad payload: ${error instanceof Error ? error.message : String(error)}`); return { skipped: false, ok: false, error: "bad payload" }; }
      const result = await createRecordAndReadBack({ serverUrl, apiKey, objectName: deliveryObjectName(claimed.target), input: (parsed.input ?? parsed) as Record<string, unknown> });
      if (result.ok && claimed.target === "twenty_appointment") {
        const appointmentId = parsed.appointmentId;
        if (typeof appointmentId !== "string" || !result.externalIds[0] || !result.readbackEvidence) { await fail("Appointment delivery is missing appointment linkage or read-back evidence"); return { skipped: false, ok: false, error: "Appointment delivery is missing appointment linkage or read-back evidence" }; }
        await ctx.runMutation(internal.appointments.confirmFromReadback, { appointmentId: appointmentId as never, externalId: result.externalIds[0], readbackEvidence: result.readbackEvidence, bindingId: claimed.bindingId, now: Date.now() });
      }
      await ctx.runMutation(internal.deliveries.finish, { deliveryId: args.deliveryId, leaseToken: claimed.leaseToken, ok: result.ok, externalIds: result.externalIds, readbackEvidence: result.readbackEvidence, error: result.error, now: Date.now() });
      return { skipped: false, ok: result.ok, externalIds: result.externalIds, error: result.error };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await fail(message, /(timeout|5\d\d|malformed|readback|aborted|connection)/i.test(message));
      return { skipped: false, ok: false, error: message };
    }
  },
});

async function readMappedObject(ctx: any, args: { organizationId: any; bindingKey?: string; objectType: "opportunity" | "payment"; query: string }) {
  const binding = await ctx.runQuery(internal.integrationBindings.resolve, { organizationId: args.organizationId, bindingKey: args.bindingKey ?? "twenty-primary" });
  const mapping = binding?.twentyObjectMappings?.find((entry: { workstationType: string }) => entry.workstationType === args.objectType || entry.workstationType === `${args.objectType}s`);
  const serverUrl = binding ? bindingUrl(binding) : undefined;
  const secretReference = binding?.secretReferenceNames?.find((name: string) => name === "TWENTY_MCP_API_KEY") ?? binding?.secretReferenceNames?.[0];
  const apiKey = secretReference ? process.env[secretReference] : undefined;
  if (!binding || !mapping || !serverUrl || !secretReference || !apiKey) return { ok: false, records: [], coverageState: "unknown" as const, warning: "Twenty object mapping or binding is unverified" };
  let parsed: Record<string, unknown>;
  try { parsed = JSON.parse(args.query) as Record<string, unknown>; } catch { return { ok: false, records: [], coverageState: "unknown" as const, warning: "Twenty read query is malformed" }; }
  return readRecords({ serverUrl, apiKey, objectName: mapping.twentyObject, query: parsed });
}

export const readOpportunities = internalAction({
  args: { organizationId: v.id("organizations"), bindingKey: v.optional(v.string()), query: v.string() },
  handler: async (ctx, args) => readMappedObject(ctx, { ...args, objectType: "opportunity" }),
});

export const readPayments = internalAction({
  args: { organizationId: v.id("organizations"), bindingKey: v.optional(v.string()), query: v.string() },
  handler: async (ctx, args) => readMappedObject(ctx, { ...args, objectType: "payment" }),
});
