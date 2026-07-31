import { useEffect, useState } from "react";
import { type Delivery, getDeliveries } from "../api/operations.js";

export interface DeliveriesPageProps {
  organizationId: string;
  fetcher?: typeof fetch;
}

export function DeliveriesPage({ organizationId, fetcher = fetch }: DeliveriesPageProps) {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void getDeliveries(organizationId, fetcher)
      .then((items) => {
        if (!cancelled) setDeliveries(items);
      })
      .catch(() => {
        if (!cancelled) setError("Deliveries could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher, organizationId]);

  return (
    <section aria-labelledby="deliveries-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operator view</p>
          <h1 id="deliveries-title">Deliveries</h1>
          <p>Recoverable downstream updates and their retry state.</p>
        </div>
      </div>
      {error ? <div className="stream-warning">{error}</div> : null}
      {deliveries.length === 0 && !error ? (
        <div className="empty-state compact">
          <h2>No deliveries recorded</h2>
          <p>Twenty updates appear here after a Dograh call completes.</p>
        </div>
      ) : (
        <div className="delivery-list section-block">
          {deliveries.map((delivery) => (
            <article className="delivery-card" key={delivery.id}>
              <div className="outcome-heading">
                <div>
                  <p className="eyebrow">CRM outcome delivery</p>
                  <h2>
                    {delivery.displayName
                      ? `${delivery.displayName}'s call outcome`
                      : "Call outcome update"}
                  </h2>
                </div>
                <span className={`health-badge health-${delivery.status}`}>{delivery.status}</span>
              </div>
              <p>{delivery.callSummary ?? "No business summary was attached to this update."}</p>
              <dl className="detail-grid">
                <div>
                  <dt>Destination</dt>
                  <dd>{delivery.destination}</dd>
                </div>
                <div>
                  <dt>Attempts</dt>
                  <dd>{delivery.attempts}</dd>
                </div>
                <div>
                  <dt>Next action</dt>
                  <dd>
                    {delivery.status === "dead"
                      ? "Manual retry required"
                      : delivery.status === "succeeded"
                        ? "Complete"
                        : new Date(delivery.nextAttemptAt).toLocaleString()}
                  </dd>
                </div>
              </dl>
              <div className="card-footer">
                <time dateTime={delivery.completedAt ?? delivery.createdAt}>
                  {new Date(delivery.completedAt ?? delivery.createdAt).toLocaleString()}
                </time>
                <span>Delivery ID {delivery.id.slice(0, 8)}</span>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
