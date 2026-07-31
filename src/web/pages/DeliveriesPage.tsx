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
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th scope="col">Destination</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Next action</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>Twenty CRM</td>
                  <td>
                    <span className={`health-badge health-${delivery.status}`}>
                      {delivery.status}
                    </span>
                  </td>
                  <td>{delivery.attempts}</td>
                  <td>
                    {delivery.status === "dead"
                      ? "Manual retry required"
                      : delivery.status === "succeeded"
                        ? "Complete"
                        : new Date(delivery.nextAttemptAt).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
