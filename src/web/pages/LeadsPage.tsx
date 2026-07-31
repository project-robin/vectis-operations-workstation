import { useEffect, useState } from "react";
import { getLeads, type LeadSummary } from "../api/operations.js";

interface LeadsPageProps {
  organizationId: string;
  fetcher?: typeof fetch;
  onViewCall: (leadId: number) => void;
}

export function LeadsPage({ organizationId, fetcher = fetch, onViewCall }: LeadsPageProps) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getLeads(organizationId, fetcher)
      .then((result) => {
        if (!cancelled) setLeads(result);
      })
      .catch(() => {
        if (!cancelled) setError("Leads could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  return (
    <section aria-labelledby="leads-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Owner view</p>
          <h1 id="leads-title">Leads</h1>
          <p>Every imported customer and the latest verified call outcome.</p>
        </div>
        <div className="status-pill status-connected">
          <span aria-hidden="true" /> {leads.length} total
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {leads.length ? (
        <div className="outcome-list section-block">
          {leads.map((lead) => (
            <article className="outcome-card" key={lead.id}>
              <div className="outcome-heading">
                <div>
                  <h2>{lead.displayName}</h2>
                  <span>{lead.phone}</span>
                </div>
                <span className={`health-badge health-${lead.providerState ?? "unknown"}`}>
                  {lead.leadStatus ?? lead.providerState ?? "Not called"}
                </span>
              </div>
              <p>{lead.callSummary ?? "No completed call summary yet."}</p>
              <div className="tag-row">
                {lead.quoteRequested ? <span>Quote requested</span> : null}
                {lead.followUpRequired ? <span>Follow-up needed</span> : null}
                {lead.disposition ? <span>{lead.disposition.replaceAll("_", " ")}</span> : null}
              </div>
              <div className="card-footer">
                <time dateTime={lead.completedAt ?? undefined}>
                  {lead.completedAt ? new Date(lead.completedAt).toLocaleString() : "Awaiting call"}
                </time>
                <button
                  aria-label={`Open ${lead.displayName}'s call trace`}
                  type="button"
                  onClick={() => onViewCall(lead.id)}
                >
                  Open call trace
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : !error ? (
        <div className="empty-state compact">
          <h2>No leads imported</h2>
          <p>Approved CSV leads will appear here before any campaign starts.</p>
        </div>
      ) : null}
    </section>
  );
}
