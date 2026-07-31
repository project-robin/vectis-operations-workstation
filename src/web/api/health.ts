import { componentHealthResponseSchema } from "../../shared/contracts/component-health.js";

export async function getComponentHealth(organizationId: string, fetcher: typeof fetch = fetch) {
  const response = await fetcher(
    `/api/health/components?organizationId=${encodeURIComponent(organizationId)}`,
  );

  if (!response.ok) {
    throw new Error("Unable to load component health");
  }

  return componentHealthResponseSchema.parse(await response.json()).components;
}
