"use client";

import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Skeleton } from "@astryxdesign/core/Skeleton";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import type { TableColumn } from "@astryxdesign/core/Table";
import { pixel, proportional, Table } from "@astryxdesign/core/Table";
import { Text } from "@astryxdesign/core/Text";
import { useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { formatDuration, formatWhen } from "@/components/ui";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";

interface RecentCallRow extends Record<string, unknown> {
  id: string;
  contact: string;
  phone: string;
  kind: string;
  status: string;
  summary: string;
  duration: string;
  when: string;
}

const callStatus: Record<
  string,
  { label: string; variant: "success" | "warning" | "error" | "accent" | "neutral" }
> = {
  queued: { label: "Queued", variant: "neutral" },
  in_progress: { label: "Calling", variant: "accent" },
  completed: { label: "Completed", variant: "success" },
  no_answer: { label: "No answer", variant: "warning" },
  failed: { label: "Failed", variant: "error" },
};

const columns: TableColumn<RecentCallRow>[] = [
  {
    key: "contact",
    header: "Contact",
    width: proportional(1.4),
    renderCell: (call) => (
      <VStack gap={0}>
        <Link href={`/calls/${call.id}`} color="primary" weight="semibold" maxLines={1}>
          {call.contact}
        </Link>
        {call.contact !== call.phone ? <Text type="supporting">{call.phone}</Text> : null}
      </VStack>
    ),
  },
  { key: "kind", header: "Type", width: proportional(1) },
  {
    key: "status",
    header: "Status",
    width: proportional(1),
    renderCell: (call) => {
      const status = callStatus[call.status] ?? { label: call.status, variant: "neutral" as const };
      return (
        <HStack gap={2} align="center">
          <StatusDot
            variant={status.variant}
            label={status.label}
            isPulsing={call.status === "in_progress"}
          />
          <Text>{status.label}</Text>
        </HStack>
      );
    },
  },
  {
    key: "summary",
    header: "What we learned",
    width: proportional(2),
    renderCell: (call) => (
      <Text color="secondary" maxLines={2}>
        {call.summary}
      </Text>
    ),
  },
  { key: "duration", header: "Length", width: pixel(90) },
  { key: "when", header: "When", width: proportional(1) },
];

function Metric({ label, value, detail }: { label: string; value: number; detail: string }) {
  return (
    <VStack gap={1}>
      <Text type="supporting" color="secondary" display="block">
        {label}
      </Text>
      <Text type="display-2" display="block" hasTabularNumbers>
        {value}
      </Text>
      <Text type="supporting" color="secondary" display="block">
        {detail}
      </Text>
    </VStack>
  );
}

function DashboardLoading() {
  return (
    <VStack gap={8} role="status">
      <VStack gap={3}>
        <Skeleton width="35%" height="var(--font-size-3xl)" />
        <Skeleton width="55%" height="var(--font-size-base)" index={1} />
      </VStack>
      <Grid columns={{ minWidth: 220, max: 3, repeat: "fit" }} gap={6}>
        <Skeleton height="var(--spacing-10)" index={2} />
        <Skeleton height="var(--spacing-10)" index={3} />
        <Skeleton height="var(--spacing-10)" index={4} />
      </Grid>
      <Skeleton height="var(--spacing-10)" index={5} />
      <Text color="secondary">Loading your dashboard…</Text>
    </VStack>
  );
}

export function DashboardPage() {
  const router = useRouter();
  const data = useQuery(api.calls.dashboard, {});
  const workspace = useQuery(api.workspace.current, {});
  const needsOnboarding = Boolean(
    workspace?.onboardingStartedAt &&
      !workspace.onboardingDismissedAt &&
      data &&
      data.calls.completed === 0,
  );

  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  if (!data || needsOnboarding) return <DashboardLoading />;

  const { leads, calls, recentCalls, integrations } = data;
  const reachable = calls.completed + calls.no_answer;
  const reachRate = reachable > 0 ? Math.round((calls.completed / reachable) * 100) : null;
  const liveNow = calls.in_progress + calls.queued;
  const rows: RecentCallRow[] = recentCalls.map((call: Doc<"calls">) => ({
    id: call._id,
    contact: call.contactName ?? call.phone,
    phone: call.phone,
    kind: call.kind === "quick" ? "Quick call" : "Lead call",
    status: call.status,
    summary:
      call.summary ?? call.error ?? (call.status === "in_progress" ? "Call in progress…" : "—"),
    duration: formatDuration(call.durationSeconds),
    when: formatWhen(call.createdAt),
  }));

  return (
    <VStack gap={8}>
      <HStack gap={6} align="center" justify="between" wrap="wrap">
        <VStack gap={1}>
          <Text type="supporting" color="secondary" display="block">
            VOICE OPERATIONS
          </Text>
          <Heading level={1} type="display-2">
            {workspace?.businessName ?? "Overview"}
          </Heading>
          <Text color="secondary" display="block">
            Calling activity, lead coverage, and what needs your attention.
          </Text>
        </VStack>
        <HStack gap={2} align="center">
          <Button label="Add leads" href="/leads" variant="secondary" />
          <Button label="Quick call" href="/quick-call" variant="primary" />
        </HStack>
      </HStack>

      {!integrations.dograh || !integrations.quickCall ? (
        <Banner
          status="warning"
          title="Calling needs setup"
          description="Check the calling connections before starting a new call."
          endContent={<Button label="Review settings" href="/settings" size="sm" />}
        />
      ) : null}

      <Section variant="transparent" padding={0} paddingInline={8}>
        <VStack gap={5}>
          <HStack gap={4} align="center" justify="between" wrap="wrap">
            <Heading level={2}>At a glance</Heading>
            <HStack gap={2} align="center">
              <StatusDot
                variant={liveNow > 0 ? "accent" : "neutral"}
                label={liveNow > 0 ? "Calls active" : "No active calls"}
                isPulsing={liveNow > 0}
              />
              <Text type="supporting" color="secondary">
                {liveNow > 0 ? `${liveNow} live or queued` : "No calls live now"}
              </Text>
            </HStack>
          </HStack>
          <Grid columns={{ minWidth: 220, max: 3, repeat: "fit" }} gap={6}>
            <Metric
              label="Calls in the last 24 hours"
              value={calls.last24h}
              detail={`${liveNow} live or queued`}
            />
            <Metric
              label="Conversations"
              value={calls.completed}
              detail={
                reachRate === null ? "Pick-up rate unavailable" : `${reachRate}% pick-up rate`
              }
            />
            <Metric
              label="Needs follow-up"
              value={calls.followUps}
              detail={calls.followUps > 0 ? "Review flagged calls" : "Nothing flagged by the agent"}
            />
          </Grid>
        </VStack>
      </Section>

      <Section variant="muted" padding={6} paddingInline={8}>
        <VStack gap={4}>
          <HStack gap={4} align="center" justify="between" wrap="wrap">
            <VStack gap={1}>
              <Heading level={2}>Lead coverage</Heading>
              <Text color="secondary">
                {leads.called} of {leads.total} leads called
              </Text>
            </VStack>
            <Link href="/leads" isStandalone>
              Open leads
            </Link>
          </HStack>
          <ProgressBar
            label="Leads called"
            value={leads.called}
            max={Math.max(leads.total, 1)}
            variant="accent"
            isLabelHidden
            hasValueLabel
          />
          <HStack gap={4} wrap="wrap">
            <Text type="supporting" color="secondary">
              {leads.remaining} remaining
            </Text>
            <Text type="supporting" color="secondary">
              {leads.new} not called
            </Text>
            <Text type="supporting" color="secondary">
              {leads.failed} to retry
            </Text>
            <Text type="supporting" color="secondary">
              {leads.queued} in a campaign
            </Text>
          </HStack>
        </VStack>
      </Section>

      <Section variant="transparent" padding={0} paddingInline={8}>
        <VStack gap={4}>
          <HStack gap={4} align="center" justify="between">
            <Heading level={2}>Recent calls</Heading>
            <Link href="/calls" isStandalone>
              View all calls
            </Link>
          </HStack>
          {rows.length === 0 ? (
            <EmptyState
              title="Your first call will appear here"
              description="Start a quick call or add leads to begin a campaign."
              actions={<Button label="Start a quick call" href="/quick-call" variant="primary" />}
            />
          ) : (
            <Table data={rows} columns={columns} idKey="id" density="balanced" hasHover />
          )}
        </VStack>
      </Section>

      <Section variant="transparent" padding={0} paddingInline={8} dividers={["top"]}>
        <VStack gap={4} paddingBlockStart={6}>
          <HStack gap={4} align="center" justify="between">
            <Heading level={2}>Connections</Heading>
            <Link href="/settings" isStandalone>
              Manage connections
            </Link>
          </HStack>
          <Grid columns={{ minWidth: 200, max: 3, repeat: "fit" }} gap={4}>
            {[
              ["Calling provider", integrations.dograh],
              ["Quick call", integrations.quickCall],
              ["Twenty CRM", integrations.twenty],
            ].map(([label, connected]) => (
              <HStack key={String(label)} gap={2} align="center">
                <StatusDot
                  variant={connected ? "success" : "warning"}
                  label={connected ? `${label} connected` : `${label} disconnected`}
                />
                <Text>{label}</Text>
                <Text type="supporting" color="secondary">
                  {connected ? "Connected" : "Needs setup"}
                </Text>
              </HStack>
            ))}
          </Grid>
        </VStack>
      </Section>
    </VStack>
  );
}
