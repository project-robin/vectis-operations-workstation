import type { ComponentHealth } from "../../shared/contracts/component-health.js";

export interface LiveOperationsPageProps {
  components: ComponentHealth[];
  streamState: "connected" | "connecting" | "disconnected";
}

function displayName(value: string): string {
  return value
    .split(/[-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function LiveOperationsPage({ components, streamState }: LiveOperationsPageProps) {
  return (
    <section aria-labelledby="live-operations-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operator view</p>
          <h1 id="live-operations-title">Live Operations</h1>
          <p>Actual dependency state, probe latency, and the most recent verified check.</p>
        </div>
        <div className={`status-pill status-${streamState}`}>
          <span aria-hidden="true" /> {displayName(streamState)}
        </div>
      </div>

      {streamState === "disconnected" ? (
        <div className="stream-warning" role="status">
          Live updates disconnected. Displayed health may become stale until the stream reconnects.
        </div>
      ) : null}

      <div className="component-grid">
        {components.map((component) => (
          <article className="component-card" key={component.component}>
            <div className="component-card-heading">
              <div>
                <p className="eyebrow">Component</p>
                <h2>{displayName(component.component)}</h2>
              </div>
              <span className={`health-badge health-${component.status}`}>
                {displayName(component.status)}
              </span>
            </div>
            <p>{component.detail}</p>
            <dl>
              <div>
                <dt>Latency</dt>
                <dd>{component.latencyMs} ms</dd>
              </div>
              <div>
                <dt>Last checked</dt>
                <dd>{new Date(component.checkedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>

      {components.length === 0 ? (
        <div className="empty-state compact">
          <p className="eyebrow">No probes recorded</p>
          <h2>No component health yet</h2>
          <p>The monitor must complete a probe before a component appears here.</p>
        </div>
      ) : null}
    </section>
  );
}
