"use client";

import { usePaginatedQuery } from "convex/react";
import {
  CallStatusBadge,
  CrmStatusBadge,
  formatDuration,
  formatWhen,
  PageHeader,
} from "@/components/ui";
import { api } from "@/convex/_generated/api";

export function CallsPage() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.calls.list,
    {},
    { initialNumItems: 50 },
  );

  return (
    <>
      <PageHeader title="Calls" subtitle="Every call your AI agent made, with what it learned." />
      {results.length === 0 && status !== "LoadingFirstPage" ? (
        <div className="empty-state">
          No calls yet. Try a <a href="/quick-call">quick call</a>.
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Contact</th>
              <th>Type</th>
              <th>Status</th>
              <th>Summary</th>
              <th>Length</th>
              <th>CRM</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {results.map((call) => (
              <tr
                key={call._id}
                className="row-link"
                onClick={() => (window.location.href = `/calls/${call._id}`)}
              >
                <td>
                  <a href={`/calls/${call._id}`}>
                    <strong>{call.contactName ?? call.phone}</strong>
                  </a>
                  <div className="muted">{call.phone}</div>
                </td>
                <td>{call.kind === "quick" ? "Quick call" : "Lead call"}</td>
                <td>
                  <CallStatusBadge status={call.status} />
                  {call.followUpRequired ? <div className="flag">Follow up</div> : null}
                </td>
                <td>
                  <div className="clamp">{call.summary ?? call.error ?? "—"}</div>
                </td>
                <td>{formatDuration(call.durationSeconds)}</td>
                <td>
                  <CrmStatusBadge status={call.crmStatus} />
                </td>
                <td className="nowrap">{formatWhen(call.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {status === "CanLoadMore" ? (
        <div className="form-actions">
          <button className="btn" type="button" onClick={() => loadMore(100)}>
            Load more
          </button>
        </div>
      ) : null}
    </>
  );
}
