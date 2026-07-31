import { useEffect, useState } from "react";
import type { ComponentHealth } from "../../shared/contracts/component-health.js";
import {
  connectEventStream,
  type EventSourceFactory,
  type EventSourceLike,
} from "../api/event-stream.js";
import { getComponentHealth } from "../api/health.js";
import { AttentionPage } from "../pages/AttentionPage.js";
import { DeliveriesPage } from "../pages/DeliveriesPage.js";
import { ImportsPage } from "../pages/ImportsPage.js";
import { LeadTracePage } from "../pages/LeadTracePage.js";
import { LiveOperationsPage } from "../pages/LiveOperationsPage.js";

const ownerItems = ["Overview", "Leads", "Campaigns", "Attention"];
const operatorItems = ["Live Operations", "Imports", "Call Trace", "Deliveries", "Integrations"];

interface NavigationGroupProps {
  activePage: string;
  label: string;
  items: string[];
  onSelect: (page: string) => void;
}

function NavigationGroup({ activePage, label, items, onSelect }: NavigationGroupProps) {
  return (
    <nav aria-label={label} className="nav-group">
      <p className="nav-label">{label}</p>
      <ul>
        {items.map((item) => (
          <li key={item}>
            <button
              aria-current={activePage === item ? "page" : undefined}
              onClick={() => onSelect(item)}
              type="button"
            >
              {item}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function OverviewPage() {
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Business overview</p>
          <h1>Overview</h1>
          <p>Outcomes, active work, and decisions that need your attention.</p>
        </div>
        <div className="status-pill status-unknown">
          <span aria-hidden="true" /> Awaiting connection
        </div>
      </section>

      <section className="empty-state" aria-labelledby="empty-title">
        <div className="empty-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <p className="eyebrow">No source connected</p>
        <h2 id="empty-title">No operational data yet</h2>
        <p>
          Metrics will appear after the API, database, and provider health checks are connected. The
          dashboard never invents operational numbers.
        </p>
      </section>
    </>
  );
}

export interface AppProps {
  eventSourceFactory?: EventSourceFactory;
  organizationId?: string;
  fetcher?: typeof fetch;
}

function createNativeEventSource(url: string): EventSourceLike {
  const source = new EventSource(url);
  return {
    get onerror() {
      return source.onerror as (() => void) | null;
    },
    set onerror(listener) {
      source.onerror = listener;
    },
    get onopen() {
      return source.onopen as (() => void) | null;
    },
    set onopen(listener) {
      source.onopen = listener;
    },
    addEventListener: (type, listener) => source.addEventListener(type, listener),
    close: () => source.close(),
  };
}

export function App({
  eventSourceFactory,
  organizationId = import.meta.env.VITE_ORGANIZATION_ID,
  fetcher = fetch,
}: AppProps) {
  const [activePage, setActivePage] = useState("Overview");
  const [components, setComponents] = useState<ComponentHealth[]>([]);
  const [streamState, setStreamState] = useState<"connected" | "connecting" | "disconnected">(
    "disconnected",
  );

  useEffect(() => {
    if (activePage !== "Live Operations" || !organizationId) {
      return;
    }

    let cancelled = false;
    setStreamState("connecting");

    const refreshHealth = async () => {
      try {
        const health = await getComponentHealth(organizationId, fetcher);
        if (!cancelled) {
          setComponents(health);
        }
      } catch {
        if (!cancelled) {
          setComponents([]);
        }
      }
    };

    void refreshHealth();

    const availableFactory =
      eventSourceFactory ??
      (typeof EventSource === "undefined" ? undefined : createNativeEventSource);
    const disconnect = availableFactory
      ? connectEventStream(
          organizationId,
          {
            onConnected: () => {
              if (!cancelled) {
                setStreamState("connected");
              }
            },
            onDisconnected: () => {
              if (!cancelled) {
                setStreamState("disconnected");
              }
            },
            onHealthChanged: () => void refreshHealth(),
          },
          availableFactory,
        )
      : () => undefined;

    if (!availableFactory) {
      setStreamState("disconnected");
    }

    return () => {
      cancelled = true;
      disconnect();
    };
  }, [activePage, eventSourceFactory, fetcher, organizationId]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">
          V
        </div>
        <div>
          <strong>Vectis</strong>
          <span>Operations Workstation</span>
        </div>
        <div className="environment-pill">
          <span aria-hidden="true" /> Local workspace
        </div>
      </header>

      <aside className="sidebar">
        <NavigationGroup
          activePage={activePage}
          label="Owner"
          items={ownerItems}
          onSelect={setActivePage}
        />
        <NavigationGroup
          activePage={activePage}
          label="Operator"
          items={operatorItems}
          onSelect={setActivePage}
        />
      </aside>

      <main id="main" className="main-content">
        {activePage === "Live Operations" ? (
          <LiveOperationsPage components={components} streamState={streamState} />
        ) : activePage === "Imports" ? (
          organizationId ? (
            <ImportsPage organizationId={organizationId} />
          ) : (
            <section className="page-heading">
              <div>
                <h1>Imports</h1>
                <p>Set VITE_ORGANIZATION_ID to stage lead data.</p>
              </div>
            </section>
          )
        ) : activePage === "Call Trace" && organizationId ? (
          <LeadTracePage fetcher={fetcher} organizationId={organizationId} />
        ) : activePage === "Deliveries" && organizationId ? (
          <DeliveriesPage fetcher={fetcher} organizationId={organizationId} />
        ) : activePage === "Attention" && organizationId ? (
          <AttentionPage fetcher={fetcher} organizationId={organizationId} />
        ) : (
          <OverviewPage />
        )}
      </main>
    </div>
  );
}
