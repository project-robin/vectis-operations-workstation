"use client";

import { useQuery } from "convex/react";
import { BatchStatusBadge, formatWhen, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

type BatchRow = Doc<"callBatches"> & { done: number; reached: number };

export function CampaignsPage() {
  const batches = useQuery(api.calls.batches, {});

  return (
    <>
      <PageHeader
        title="Campaigns"
        subtitle="Groups of leads sent to the AI agent together. Dograh dials them in batches and retries automatically."
        actions={
          <a className="btn btn-primary" href="/leads">
            Call leads
          </a>
        }
      />
      {batches === undefined ? (
        <div className="empty-state">Loading…</div>
      ) : batches.length === 0 ? (
        <div className="empty-state">
          No campaigns yet. Go to <a href="/leads">Leads</a> and press “Call all remaining”.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Status</th>
              <th>Progress</th>
              <th>Conversations</th>
              <th>Started</th>
            </tr>
          </thead>
          <tbody>
            {batches.map((batch: BatchRow) => {
              const pct =
                batch.totalCalls > 0 ? Math.round((batch.done / batch.totalCalls) * 100) : 0;
              return (
                <tr key={batch._id}>
                  <td>
                    <strong>{batch.name}</strong>
                    {batch.error ? <div className="error-text">{batch.error}</div> : null}
                  </td>
                  <td>
                    <BatchStatusBadge status={batch.status} />
                  </td>
                  <td style={{ minWidth: 180 }}>
                    <div className="progress small">
                      <span style={{ width: `${pct}%` }} />
                    </div>
                    <span className="muted">
                      {batch.done} of {batch.totalCalls} done
                    </span>
                  </td>
                  <td>{batch.reached}</td>
                  <td className="nowrap">{formatWhen(batch.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </>
  );
}
