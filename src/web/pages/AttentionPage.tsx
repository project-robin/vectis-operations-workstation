import { useEffect, useState } from "react";
import { type AttentionItem, getAttentionItems } from "../api/operations.js";

export interface AttentionPageProps {
  organizationId: string;
  fetcher?: typeof fetch;
}

export function AttentionPage({ organizationId, fetcher = fetch }: AttentionPageProps) {
  const [items, setItems] = useState<AttentionItem[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getAttentionItems(organizationId, fetcher)
      .then((result) => {
        if (!cancelled) setItems(result);
      })
      .catch(() => {
        if (!cancelled) setError("Attention items could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  return (
    <section aria-labelledby="attention-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Owner view</p>
          <h1 id="attention-title">Attention</h1>
          <p>Calls and customer records that need a person to decide what happens next.</p>
        </div>
        <div className={`status-pill ${items.length ? "status-disconnected" : "status-connected"}`}>
          <span aria-hidden="true" /> {items.length} open
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {items.length === 0 && !error ? (
        <div className="empty-state compact">
          <h2>Nothing needs attention</h2>
          <p>Failed calls and exhausted CRM retries will appear here.</p>
        </div>
      ) : (
        <div className="attention-list">
          {items.map((item) => (
            <article className="component-card" key={item.id}>
              <div className="component-card-heading">
                <div>
                  <p className="eyebrow">
                    {item.kind === "delivery_dead" ? "Customer record" : "Call"}
                  </p>
                  <h2>{item.title}</h2>
                </div>
                {item.retryable ? (
                  <span className="health-badge health-dead">Retry available</span>
                ) : null}
              </div>
              <p>{item.summary}</p>
              {item.leadId ? <small>Lead #{item.leadId}</small> : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
