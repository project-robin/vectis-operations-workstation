import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("healthy"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
