export type HealthStatus = "healthy" | "degraded" | "down" | "unknown";

export interface HealthProbeResult {
  component: string;
  status: HealthStatus;
  detail: string;
  checkedAt: Date;
  latencyMs: number;
}

export interface HealthProbeOptions {
  component: string;
  timeoutMs: number;
  probe: (signal: AbortSignal) => Promise<{ detail: string; status?: "healthy" | "degraded" }>;
}

class ProbeTimeoutError extends Error {}

export async function probeHealth(options: HealthProbeOptions): Promise<HealthProbeResult> {
  const startedAt = performance.now();
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      reject(new ProbeTimeoutError());
      controller.abort();
    }, options.timeoutMs);
  });

  try {
    const probeResult = await Promise.race([options.probe(controller.signal), timeout]);
    return {
      component: options.component,
      status: probeResult.status ?? "healthy",
      detail: probeResult.detail,
      checkedAt: new Date(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    return {
      component: options.component,
      status: "down",
      detail:
        error instanceof ProbeTimeoutError || controller.signal.aborted
          ? "Probe timed out"
          : "Probe failed",
      checkedAt: new Date(),
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
