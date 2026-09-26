import { query } from "./_generated/server";
import { requireUser } from "./lib/auth";

export const getCurrent = query({
  args: {},
  handler: async (ctx) => {
    const { user } = await requireUser(ctx);
    return {
      clerkId: user.clerkId,
      name: user.name,
      email: user.email,
      imageUrl: user.imageUrl,
    };
  },
});
