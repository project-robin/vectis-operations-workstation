import { z } from "zod";

const serverEnvironmentSchema = z
  .object({
    DATABASE_URL: z.url(),
    HOST: z.string().min(1).default("127.0.0.1"),
    PORT: z.coerce.number().int().min(1).max(65535).default(4100),
    WORKSTATION_API_KEY: z.string().min(12).optional(),
  })
  .superRefine((environment, context) => {
    const loopbackHosts = new Set(["127.0.0.1", "localhost", "::1"]);
    if (!loopbackHosts.has(environment.HOST) && !environment.WORKSTATION_API_KEY) {
      context.addIssue({
        code: "custom",
        path: ["WORKSTATION_API_KEY"],
        message: "WORKSTATION_API_KEY is required for non-loopback binding",
      });
    }
  });

export function readServerConfig(environment: Record<string, string | undefined>) {
  const parsed = serverEnvironmentSchema.parse(environment);
  return {
    databaseUrl: parsed.DATABASE_URL,
    host: parsed.HOST,
    port: parsed.PORT,
    ...(parsed.WORKSTATION_API_KEY ? { apiKey: parsed.WORKSTATION_API_KEY } : {}),
  };
}
