"use client";

import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";

export function ProbeCount() {
  const count = useQuery(api.toolchain.probeCount, {});
  const recordProbe = useMutation(api.toolchain.recordProbe);
  const removeProbe = useMutation(api.toolchain.removeProbe);
  const [probeId, setProbeId] = useState<Id<"toolchainProbes"> | null>(null);

  async function handleRecord() {
    const id = await recordProbe({ label: "shell" });
    setProbeId(id);
  }

  async function handleRemove() {
    if (probeId === null) return;
    await removeProbe({ probeId });
    setProbeId(null);
  }

  return (
    <section aria-label="Convex reactive probe">
      <p role="status">Probes: {count === undefined ? "loading" : count}</p>
      <button type="button" onClick={() => void handleRecord()}>
        Record probe
      </button>
      {probeId !== null ? (
        <button type="button" onClick={() => void handleRemove()}>
          Remove probe
        </button>
      ) : null}
    </section>
  );
}
