import { mutation, query } from "./_generated/server";
import { addOrganizationMember, getCurrentOrganization, memberArgs } from "./lib/onboarding";

export const addMember = mutation({
  args: memberArgs,
  handler: async (ctx, args) => addOrganizationMember(ctx, args),
});

export const getCurrent = query({
  args: {},
  handler: async (ctx) => getCurrentOrganization(ctx),
});
