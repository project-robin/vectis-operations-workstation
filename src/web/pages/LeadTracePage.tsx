import { useEffect, useState } from "react";
import { getLeads, getLeadTrace, type LeadSummary, type LeadTrace } from "../api/operations.js";

export interface LeadTracePageProps {
  organizationId: string;
  fetcher?: typeof fetch;
}

export function LeadTracePage({ organizationId, fetcher = fetch }: LeadTracePageProps) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [trace, setTrace] = useState<LeadTrace | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getLeads(organizationId, fetcher)
      .then(async (items) => {
        if (cancelled) return;
        setLeads(items);
        if (items[0]) {
          const result = await getLeadTrace(organizationId, items[0].id, fetcher);
          if (!cancelled) setTrace(result);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Lead trace could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  const selectLead = async (leadId: number) => {
    setError("");
    try {
      setTrace(await getLeadTrace(organizationId, leadId, fetcher));
    } catch {
      setError("Lead trace could not be loaded.");
    }
  };

  return (
    <section aria-labelledby="lead-trace-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operator view</p>
          <h1 id="lead-trace-title">Call Trace</h1>
          <p>Follow one lead from import through Dograh execution and Twenty delivery.</p>
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {leads.length === 0 && !error ? (
        <div className="empty-state compact">
          <h2>No leads to trace</h2>
          <p>Approved imported leads appear here after they enter a campaign.</p>
        </div>
      ) : (
        <div className="trace-layout">
          <aside className="trace-leads" aria-label="Leads">
            {leads.map((lead) => (
              <button
                aria-pressed={trace?.lead.id === lead.id}
                key={lead.id}
                onClick={() => void selectLead(lead.id)}
                type="button"
              >
                <strong>{lead.displayName}</strong>
                <span>{lead.phone}</span>
                <span>{lead.providerState ?? "Not called"}</span>
              </button>
            ))}
          </aside>
          {trace ? (
            <div className="trace-panel">
              <div className="component-card-heading">
                <div>
                  <p className="eyebrow">Lead #{trace.lead.id}</p>
                  <h2>{trace.lead.displayName}</h2>
                </div>
                <span className="health-badge">{trace.lead.classification}</span>
              </div>
              <ol className="timeline-list">
                {trace.timeline.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-dot" aria-hidden="true" />
                    <div>
                      <strong>{event.title}</strong>
                      <p>
                        {event.component} · {event.status}
                      </p>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleString()}
                      </time>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
