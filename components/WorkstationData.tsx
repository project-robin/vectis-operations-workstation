"use client";

import { Card } from "@astryxdesign/core/Card";
import { Heading } from "@astryxdesign/core/Heading";
import { VStack } from "@astryxdesign/core/Stack";
import { Text } from "@astryxdesign/core/Text";
import { useConvexAuth, useQuery } from "convex/react";
import { CalendarCheck, CheckCircle2, Database, PhoneCall, UserCheck } from "lucide-react";
import { useMemo } from "react";
import { api } from "@/convex/_generated/api";

export type WorkstationSection =
  | "home"
  | "customers"
  | "conversations"
  | "tasks"
  | "agents"
  | "imports"
  | "campaigns"
  | "deliveries"
  | "integrations"
  | "live-operations"
  | "audit";

type DataQueryProps = { section: WorkstationSection };

function DataState({
  message,
  actionHref,
  actionLabel,
}: {
  message: string;
  actionHref?: string;
  actionLabel?: string;
}) {
  return (
    <div className="data-state" role="status">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: "48px",
          height: "48px",
          borderRadius: "12px",
          background: "var(--bg-surface-hover)",
          color: "var(--text-secondary)",
          marginBottom: "4px",
          border: "1px solid var(--border-subtle)",
        }}
        aria-hidden="true"
      >
        <Database size={22} />
      </span>
      <span style={{ maxWidth: "480px", lineHeight: "1.6", color: "var(--text-secondary)" }}>
        {message}
      </span>
      {actionHref && actionLabel ? (
        <a
          href={actionHref}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "12px",
            padding: "8px 20px",
            background: "var(--accent-primary)",
            color: "var(--text-inverse)",
            borderRadius: "var(--radius-pill)",
            fontWeight: 600,
            fontSize: "13px",
            textDecoration: "none",
            boxShadow: "var(--shadow-xs)",
            transition: "all 0.15s ease",
          }}
        >
          {actionLabel}
        </a>
      ) : null}
    </div>
  );
}

interface CustomerRow {
  _id: string;
  displayName: string;
  email?: string;
  phone?: string;
}

interface ConversationRow {
  _id: string;
  title?: string;
  status: string;
}

interface WorkItemRow {
  _id: string;
  type: string;
  status: string;
  priority: string;
}

interface ImportBatchRow {
  _id: string;
  name: string;
  status: string;
}

interface CampaignRow {
  _id: string;
  name: string;
  status: string;
  processedRows: number;
  totalRows: number;
}

interface DeliveryRow {
  _id: string;
  target: string;
  status: string;
  attempts: number;
}

interface IntegrationBindingRow {
  _id: string;
  bindingKey: string;
  provider: string;
  health?: { status: string };
}

function HomeData() {
  const range = useMemo(() => {
    const endAt = Date.now();
    return { startAt: endAt - 24 * 60 * 60 * 1000, endAt };
  }, []);
  const result = useQuery(api.analytics.getHomeSummary, range);
  if (!result || typeof result !== "object" || !("funnel" in result)) {
    return <DataState message="Waiting for verified commercial evidence..." />;
  }
  const funnel = (result as { funnel: Record<string, { count: number }> }).funnel;
  return (
    <section className="data-grid" aria-label="Verified activity summary">
      <Card padding={4}>
        <VStack gap={3}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "var(--accent-blue-bg)",
              color: "var(--accent-blue)",
              border: "1px solid var(--accent-blue-border)",
            }}
            aria-hidden="true"
          >
            <PhoneCall size={18} />
          </span>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Calls handled
            </Text>
            <Heading level={2}>{funnel.called?.count ?? 0}</Heading>
          </VStack>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "var(--accent-emerald-bg)",
              color: "var(--accent-emerald)",
              border: "1px solid var(--accent-emerald-border)",
            }}
            aria-hidden="true"
          >
            <UserCheck size={18} />
          </span>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Reached
            </Text>
            <Heading level={2}>{funnel.reached?.count ?? 0}</Heading>
          </VStack>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "var(--accent-amber-bg)",
              color: "var(--accent-amber)",
              border: "1px solid var(--accent-amber-border)",
            }}
            aria-hidden="true"
          >
            <CheckCircle2 size={18} />
          </span>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Qualified
            </Text>
            <Heading level={2}>{funnel.qualified?.count ?? 0}</Heading>
          </VStack>
        </VStack>
      </Card>
      <Card padding={4}>
        <VStack gap={3}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "var(--accent-orange-bg)",
              color: "var(--accent-orange)",
              border: "1px solid var(--accent-orange-border)",
            }}
            aria-hidden="true"
          >
            <CalendarCheck size={18} />
          </span>
          <VStack gap={1}>
            <Text type="label" color="secondary">
              Bookings confirmed
            </Text>
            <Heading level={2}>{funnel.bookingConfirmed?.count ?? 0}</Heading>
          </VStack>
        </VStack>
      </Card>
      <p className="data-note">
        Commercial values are shown only when the source and attribution evidence are verified.
      </p>
    </section>
  );
}

function CustomersData() {
  const result = useQuery(api.customers.listCustomers, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  if (!result || typeof result !== "object" || !("page" in result)) {
    return <DataState message="Loading tenant-scoped customers..." />;
  }
  const page = (result as { page: CustomerRow[] }).page;
  if (page.length === 0) {
    return (
      <DataState message="No customers are available for this organization yet. Approved imports will appear here." />
    );
  }
  return (
    <section className="record-list" aria-label="Customers list">
      {page.map((customer: CustomerRow) => (
        <a href={`/customers/${customer._id}`} className="record-row" key={customer._id}>
          <strong>{customer.displayName}</strong>
          <span>{customer.email ?? customer.phone ?? "No contact identity"}</span>
        </a>
      ))}
    </section>
  );
}

function ConversationsData() {
  const result = useQuery(api.conversations.listRecentConversations, {
    limit: 25,
  });
  if (!result || !Array.isArray(result)) {
    return <DataState message="Loading recent conversations..." />;
  }
  if (result.length === 0) {
    return <DataState message="No conversations have been recorded for this organization." />;
  }
  return (
    <div className="record-list">
      {result.map((row: ConversationRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.title ?? "Voice conversation"}</strong>
          <span>{row.status}</span>
        </div>
      ))}
    </div>
  );
}

function TasksData() {
  const result = useQuery(api.workItems.listWorkItems, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  if (!result || typeof result !== "object" || !("page" in result)) {
    return <DataState message="Loading human work items..." />;
  }
  const page = (result as { page: WorkItemRow[] }).page;
  if (page.length === 0) {
    return <DataState message="No open work items need attention." />;
  }
  return (
    <div className="record-list">
      {page.map((row: WorkItemRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.type.replaceAll("_", " ")}</strong>
          <span>
            {row.status} · {row.priority}
          </span>
        </div>
      ))}
    </div>
  );
}

function ImportsData() {
  const result = useQuery(api.imports.listImportBatches, {});
  if (!result || !Array.isArray(result)) {
    return <DataState message="Loading import batches..." />;
  }
  if (result.length === 0) {
    return (
      <DataState message="No import batches exist. Imports require a consent classification before commit." />
    );
  }
  return (
    <div className="record-list">
      {result.map((row: ImportBatchRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.name}</strong>
          <span>{row.status}</span>
        </div>
      ))}
    </div>
  );
}

function CampaignsData() {
  const result = useQuery(api.campaigns.listCampaigns, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  if (!result || typeof result !== "object" || !("page" in result)) {
    return <DataState message="Loading campaign projections..." />;
  }
  const page = (result as { page: CampaignRow[] }).page;
  if (page.length === 0) {
    return (
      <DataState message="No campaigns are available. Campaigns require an approved, consented batch." />
    );
  }
  return (
    <div className="record-list">
      {page.map((row: CampaignRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.name}</strong>
          <span>
            {row.status} · {row.processedRows}/{row.totalRows} processed
          </span>
        </div>
      ))}
    </div>
  );
}

function DeliveriesData() {
  const result = useQuery(api.deliveries.listDeliveries, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  if (!result || typeof result !== "object" || !("page" in result)) {
    return <DataState message="Loading delivery state..." />;
  }
  const page = (result as { page: DeliveryRow[] }).page;
  if (page.length === 0) {
    return <DataState message="No delivery records require attention." />;
  }
  return (
    <div className="record-list">
      {page.map((row: DeliveryRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.target.replaceAll("_", " ")}</strong>
          <span>
            {row.status} · attempt {row.attempts}
          </span>
        </div>
      ))}
    </div>
  );
}

function IntegrationsData() {
  const result = useQuery(api.integrationBindings.list, {});
  if (!result || !Array.isArray(result)) {
    return <DataState message="Loading integration bindings..." />;
  }
  if (result.length === 0) {
    return <DataState message="No integration bindings are configured for this organization." />;
  }
  return (
    <div className="record-list">
      {result.map((row: IntegrationBindingRow) => (
        <div className="record-row" key={row._id}>
          <strong>{row.bindingKey}</strong>
          <span>
            {row.provider} · {row.health?.status ?? "unknown"}
          </span>
        </div>
      ))}
    </div>
  );
}

function ConnectedData({ section }: DataQueryProps) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  if (isLoading) return <DataState message="Checking Clerk authentication..." />;
  if (!isAuthenticated) {
    return (
      <DataState
        message="Sign in with Clerk to load organization-scoped data."
        actionHref="/sign-in"
        actionLabel="Sign in to Organization"
      />
    );
  }

  if (section === "home") return <HomeData />;
  if (section === "customers") return <CustomersData />;
  if (section === "conversations") return <ConversationsData />;
  if (section === "tasks") return <TasksData />;
  if (section === "imports") return <ImportsData />;
  if (section === "campaigns" || section === "live-operations") {
    return <CampaignsData />;
  }
  if (section === "deliveries") return <DeliveriesData />;
  if (section === "integrations") return <IntegrationsData />;
  if (section === "agents") {
    return (
      <DataState message="The Agents read model is not available yet. No agent health or outcome data is being inferred." />
    );
  }
  return (
    <DataState message="Audit read access is not available in the current Convex query seam. No audit records are fabricated." />
  );
}

export function WorkstationData({ section, enabled }: DataQueryProps & { enabled: boolean }) {
  if (!enabled) {
    return <DataState message="Live data is unavailable until Convex is configured." />;
  }
  return <ConnectedData section={section} />;
}
