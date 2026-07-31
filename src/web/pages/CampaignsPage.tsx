import { useEffect, useState } from "react";
import { type CampaignSummary, getCampaigns } from "../api/operations.js";

interface CampaignsPageProps {
  organizationId: string;
  fetcher?: typeof fetch;
}

export function CampaignsPage({ organizationId, fetcher = fetch }: CampaignsPageProps) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getCampaigns(organizationId, fetcher)
      .then((result) => {
        if (!cancelled) setCampaigns(result);
      })
      .catch(() => {
        if (!cancelled) setError("Campaigns could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  return (
    <section aria-labelledby="campaigns-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Owner view</p>
          <h1 id="campaigns-title">Campaigns</h1>
          <p>Call progress and outcomes for every approved outreach campaign.</p>
        </div>
        <div className="status-pill status-connected">
          <span aria-hidden="true" /> {campaigns.length} total
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {campaigns.length ? (
        <div className="campaign-list section-block">
          {campaigns.map((campaign) => {
            const progress = campaign.totalLeads
              ? Math.min(100, Math.round((campaign.processedCalls / campaign.totalLeads) * 100))
              : 0;
            return (
              <article className="campaign-card" key={campaign.id}>
                <div className="outcome-heading">
                  <div>
                    <p className="eyebrow">Workflow {campaign.workflowId}</p>
                    <h2>{campaign.name}</h2>
                  </div>
                  <span className={`health-badge health-${campaign.status}`}>
                    {campaign.status}
                  </span>
                </div>
                <div className="progress-copy">
                  <strong>
                    {campaign.processedCalls} of {campaign.totalLeads} calls processed
                  </strong>
                  <span>{progress}%</span>
                </div>
                <div
                  aria-label={`${progress}% campaign progress`}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={progress}
                  className="progress-track"
                  role="progressbar"
                >
                  <span style={{ width: `${progress}%` }} />
                </div>
                <div className="metric-grid compact-grid">
                  <div className="metric-card">
                    <strong>{campaign.completedCalls}</strong>
                    <span>Completed calls</span>
                  </div>
                  <div className="metric-card">
                    <strong>{campaign.failedCalls}</strong>
                    <span>{campaign.failedCalls ? "Failed calls" : "No failed calls"}</span>
                  </div>
                  <div className="metric-card">
                    <strong>{campaign.totalLeads - campaign.processedCalls}</strong>
                    <span>Not yet processed</span>
                  </div>
                </div>
                <div className="card-footer">
                  <time dateTime={campaign.startedAt ?? campaign.createdAt}>
                    Started {new Date(campaign.startedAt ?? campaign.createdAt).toLocaleString()}
                  </time>
                  <span>
                    {campaign.status === "paused"
                      ? "Paused—no further calls will start"
                      : `Campaign ${campaign.status}`}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      ) : !error ? (
        <div className="empty-state compact">
          <h2>No campaigns yet</h2>
          <p>Approve an import before preparing the first consented campaign.</p>
        </div>
      ) : null}
    </section>
  );
}
