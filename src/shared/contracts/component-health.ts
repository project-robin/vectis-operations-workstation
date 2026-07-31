import { z } from "zod";

export const componentHealthSchema = z.object({
  id: z.number().int().positive(),
  organizationId: z.uuid(),
  component: z.string().min(1),
  status: z.enum(["healthy", "degraded", "down", "unknown"]),
  detail: z.string(),
  latencyMs: z.number().int().nonnegative(),
  checkedAt: z.iso.datetime(),
});

export const componentHealthResponseSchema = z.object({
  components: z.array(componentHealthSchema),
});

export type ComponentHealth = z.infer<typeof componentHealthSchema>;
