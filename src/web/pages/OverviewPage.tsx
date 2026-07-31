import { useEffect, useState } from "react";
import { getOwnerOverview, type OwnerOverview } from "../api/operations.js";

interface OverviewPageProps {
  organizationId: string;
  fetcher?: typeof fetch;
  onViewCall: (leadId: number) => void;
}

export function OverviewPage({ organizationId, fetcher = fetch, onViewCall }: OverviewPageProps) {
  const [overview, setOverview] = useState<OwnerOverview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getOwnerOverview(organizationId, fetcher)
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch(() => {
        if (!cancelled) setError("Operational summary could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  const metrics = overview?.metrics;
  return (
    <section aria-labelledby="overview-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Business overview</p>
          <h1 id="overview-title">Overview</h1>
          <p>Verified call outcomes, customer interest, and work that needs a response.</p>
        </div>
        <div className={`status-pill ${overview ? "status-connected" : "status-connecting"}`}>
          <span aria-hidden="true" /> {overview ? "Live data" : "Loading"}
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {metrics ? (
        <section className="metric-grid" aria-label="Operational metrics">
          {[
            [metrics.totalLeads, "Leads"],
            [metrics.callsCompleted, "Calls completed"],
            [metrics.qualifiedLeads, "Qualified leads"],
            [metrics.followUpsRequired, "Follow-ups needed"],
            [metrics.crmSynced, "CRM records synced"],
          ].map(([value, label]) => (
            <article className="metric-card" key={label}>
              <strong>{value}</strong>
              <span>{label}</span>
            </article>
          ))}
        </section>
      ) : null}
      {overview?.recentOutcomes.length ? (
        <section className="section-block" aria-labelledby="recent-outcomes-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent outcomes</p>
              <h2 id="recent-outcomes-title">What customers said</h2>
            </div>
          </div>
          <div className="outcome-list">
            {overview.recentOutcomes.map((outcome) => (
              <article className="outcome-card" key={`${outcome.leadId}-${outcome.completedAt}`}>
                <div className="outcome-heading">
                  <div>
                    <h3>{outcome.displayName}</h3>
                    <span>{outcome.phone}</span>
                  </div>
                  <span className="health-badge health-succeeded">
                    {outcome.leadStatus === "qualified" ? "Qualified" : outcome.state}
                  </span>
                </div>
                <p>{outcome.summary ?? "The call completed without a business summary."}</p>
                <div className="tag-row">
                  {outcome.quoteRequested ? <span>Quote requested</span> : null}
                  {outcome.followUpRequired ? <span>Follow-up needed</span> : null}
                  {outcome.disposition ? (
                    <span>{outcome.disposition.replaceAll("_", " ")}</span>
                  ) : null}
                </div>
                <div className="card-footer">
                  <time dateTime={outcome.completedAt ?? undefined}>
                    {outcome.completedAt
                      ? new Date(outcome.completedAt).toLocaleString()
                      : "In progress"}
                  </time>
                  <button
                    aria-label={`View ${outcome.displayName}'s call`}
                    type="button"
                    onClick={() => onViewCall(outcome.leadId)}
                  >
                    View call
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : overview && !error ? (
        <div className="empty-state compact">
          <h2>No calls completed yet</h2>
          <p>Completed call outcomes will appear here after the provider callback is verified.</p>
        </div>
      ) : null}
    </section>
  );
}
