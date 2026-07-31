import type { ComponentHealth } from "../../shared/contracts/component-health.js";

interface IntegrationsPageProps {
  components: ComponentHealth[];
  streamState: "connected" | "connecting" | "disconnected";
}

function displayName(component: string): string {
  if (component === "dograh") return "Dograh";
  if (component === "twenty") return "Twenty CRM";
  if (component === "database") return "Workstation Database";
  if (component === "workstation-api") return "Workstation API";
  return component.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function IntegrationsPage({ components, streamState }: IntegrationsPageProps) {
  const unhealthy = components.filter((component) => component.status !== "healthy").length;

  return (
    <section aria-labelledby="integrations-title">
      <div className="page-heading">
        <div>
          <p className="eyebrow">Operator view</p>
          <h1 id="integrations-title">Integrations</h1>
          <p>Verified connection health and the path each call outcome follows.</p>
        </div>
        <div
          className={`status-pill ${streamState === "connected" ? "status-connected" : "status-unknown"}`}
        >
          <span aria-hidden="true" /> {streamState === "connected" ? "Live updates" : "Snapshot"}
        </div>
      </div>

      <section className="integration-flow section-block" aria-labelledby="integration-flow-title">
        <p className="eyebrow">Outcome data path</p>
        <h2 id="integration-flow-title">Dograh → Workstation → Twenty CRM</h2>
        <ol>
          <li>
            <strong>1. Dograh completes the call</strong>
            <span>Recording, transcript, disposition, and gathered customer context.</span>
          </li>
          <li>
            <strong>2. Workstation validates and correlates it</strong>
            <span>The secure webhook links the provider run to one imported lead.</span>
          </li>
          <li>
            <strong>3. Twenty receives one CRM outcome</strong>
            <span>The outbox retries safely and prevents duplicate notes.</span>
          </li>
        </ol>
      </section>

      <div className="section-heading">
        <div>
          <p className="eyebrow">Latest checks</p>
          <h2>Component health</h2>
        </div>
        {components.length ? (
          <span className={`health-badge ${unhealthy ? "health-degraded" : "health-healthy"}`}>
            {unhealthy ? `${unhealthy} need attention` : "All reported systems healthy"}
          </span>
        ) : null}
      </div>
      {components.length ? (
        <div className="component-grid">
          {components.map((component) => (
            <article className="component-card" key={component.component}>
              <div className="component-card-heading">
                <div>
                  <p className="eyebrow">Integration</p>
                  <h3>{displayName(component.component)}</h3>
                </div>
                <span className={`health-badge health-${component.status}`}>
                  {component.status}
                </span>
              </div>
              <p>{component.detail ?? "No detail was reported."}</p>
              <div className="component-meta">
                <span>
                  {component.latencyMs === null
                    ? "Latency unavailable"
                    : `${component.latencyMs} ms`}
                </span>
                <time dateTime={component.checkedAt}>
                  Checked {new Date(component.checkedAt).toLocaleString()}
                </time>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state compact">
          <h2>No component checks yet</h2>
          <p>Start the health monitor to publish real Dograh, database, and CRM connectivity.</p>
        </div>
      )}
    </section>
  );
}
