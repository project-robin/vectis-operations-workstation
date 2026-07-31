import { useEffect, useState } from "react";
import { getLeads, getLeadTrace, type LeadSummary, type LeadTrace } from "../api/operations.js";

export interface LeadTracePageProps {
  organizationId: string;
  fetcher?: typeof fetch;
  initialLeadId?: number | null;
}

function contextString(context: Record<string, unknown> | null, key: string): string | null {
  const value = context?.[key];
  return typeof value === "string" && value ? value : null;
}

function contextBoolean(context: Record<string, unknown> | null, key: string): boolean {
  const value = context?.[key];
  return value === true || (typeof value === "string" && value.toLowerCase() === "true");
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function LeadTracePage({
  organizationId,
  fetcher = fetch,
  initialLeadId = null,
}: LeadTracePageProps) {
  const [leads, setLeads] = useState<LeadSummary[]>([]);
  const [trace, setTrace] = useState<LeadTrace | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getLeads(organizationId, fetcher)
      .then(async (items) => {
        if (cancelled) return;
        setLeads(items);
        const selected = items.find((item) => item.id === initialLeadId) ?? items[0];
        if (selected) {
          const result = await getLeadTrace(organizationId, selected.id, fetcher);
          if (!cancelled) setTrace(result);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Lead trace could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, initialLeadId, organizationId]);

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
              {trace.runs[0] ? (
                <section className="call-outcome" aria-labelledby="call-outcome-title">
                  <div className="section-heading">
                    <div>
                      <p className="eyebrow">Latest call</p>
                      <h3 id="call-outcome-title">Call outcome</h3>
                    </div>
                    <span className={`health-badge health-${trace.runs[0].state}`}>
                      {titleCase(
                        contextString(trace.runs[0].gatheredContext, "lead_status") ??
                          trace.runs[0].state,
                      )}
                    </span>
                  </div>
                  <p className="outcome-summary">
                    {contextString(trace.runs[0].gatheredContext, "call_summary") ??
                      "The provider completed without a business summary."}
                  </p>
                  <dl className="detail-grid">
                    {contextString(trace.runs[0].gatheredContext, "hair_loss_concern") ? (
                      <div>
                        <dt>Concern</dt>
                        <dd>
                          {titleCase(
                            contextString(trace.runs[0].gatheredContext, "hair_loss_concern") ?? "",
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {contextString(trace.runs[0].gatheredContext, "treatment_interest") ? (
                      <div>
                        <dt>Interested in</dt>
                        <dd>
                          {titleCase(
                            contextString(trace.runs[0].gatheredContext, "treatment_interest") ??
                              "",
                          )}
                        </dd>
                      </div>
                    ) : null}
                    {contextString(trace.runs[0].gatheredContext, "language_used") ? (
                      <div>
                        <dt>Language</dt>
                        <dd>
                          {titleCase(
                            contextString(trace.runs[0].gatheredContext, "language_used") ?? "",
                          )}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <div className="tag-row">
                    {contextBoolean(trace.runs[0].gatheredContext, "quote_requested") ? (
                      <span>Quote requested</span>
                    ) : null}
                    {contextBoolean(trace.runs[0].gatheredContext, "appointment_requested") ? (
                      <span>Consultation requested</span>
                    ) : null}
                    {contextBoolean(trace.runs[0].gatheredContext, "follow_up_required") ? (
                      <span>Follow-up needed</span>
                    ) : null}
                  </div>
                  <div className="artifact-links">
                    {trace.runs[0].recordingUrl ? (
                      <a href={trace.runs[0].recordingUrl} rel="noreferrer" target="_blank">
                        Listen to recording
                      </a>
                    ) : null}
                    {trace.runs[0].transcriptUrl ? (
                      <a href={trace.runs[0].transcriptUrl} rel="noreferrer" target="_blank">
                        Read transcript
                      </a>
                    ) : null}
                  </div>
                </section>
              ) : null}
              <div className="section-heading timeline-heading">
                <div>
                  <p className="eyebrow">System trace</p>
                  <h3>Step-by-step history</h3>
                </div>
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
