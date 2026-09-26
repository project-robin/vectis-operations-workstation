"use node";

import { v } from "convex/values";
import { internalAction } from "./_generated/server";

const FIXED_REQUESTS = {
  synthetic: "data:text/plain,task-2-fetch",
} as const;

export const fetchText = internalAction({
  args: { target: v.literal("synthetic") },
  handler: async (_ctx, args) => {
    const response = await fetch(FIXED_REQUESTS[args.target]);
    return { status: response.status, body: await response.text() };
  },
});
