"use client";

import { Button } from "@astryxdesign/core/Button";
import { Card } from "@astryxdesign/core/Card";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { Grid } from "@astryxdesign/core/Grid";
import { Heading } from "@astryxdesign/core/Heading";
import { Link } from "@astryxdesign/core/Link";
import { ProgressBar } from "@astryxdesign/core/ProgressBar";
import { Section } from "@astryxdesign/core/Section";
import { Selector } from "@astryxdesign/core/Selector";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { formatDuration, PageHeader } from "@/components/ui";
import { api } from "@/convex/_generated/api";

const DAY = 24 * 60 * 60 * 1000;
const periodOptions = [
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
];

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card padding={5}>
      <VStack gap={2}>
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
    </Card>
  );
}

function bucketLabel(startAt: number, endAt: number) {
  const date = (value: number) =>
    new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return endAt - startAt <= DAY * 1.5 ? date(startAt) : `${date(startAt)}–${date(endAt - 1)}`;
}

export function CallingAnalyticsPage() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const range = useMemo(() => {
    const endAt = Date.now();
    return { startAt: endAt - days * DAY, endAt };
  }, [days]);
  const data = useQuery(api.calls.callingAnalytics, range);
  const leads = useQuery(api.leads.stats, {});

  return (
    <VStack gap={8}>
      <PageHeader
        title="Analytics"
        subtitle="Calling activity and outcomes from your workspace records."
        actions={
          <Selector
            label="Period"
            options={periodOptions}
            value={String(days)}
            onChange={(value) => setDays(Number(value) as 7 | 30 | 90)}
          />
        }
      />

      {data === undefined || leads === undefined ? (
        <Section variant="transparent" padding={0} paddingInline={8}>
          <Text color="secondary">Loading live analytics…</Text>
        </Section>
      ) : data.totalCalls === 0 ? (
        <Section variant="transparent" padding={0} paddingInline={8}>
          <EmptyState
            title="No calls in this period"
            description="Your first call and its result will appear here as soon as the agent runs."
            actions={<Button label="Start a quick call" href="/quick-call" variant="primary" />}
          />
        </Section>
      ) : (
        <>
          <Section variant="transparent" padding={0} paddingInline={8}>
            <VStack gap={4}>
              <Heading level={2}>Calling at a glance</Heading>
              <Grid columns={{ minWidth: 220, max: 4, repeat: "fit" }} gap={4}>
                <Metric
                  label="Calls placed"
                  value={data.totalCalls}
                  detail={`${data.kind.quick} quick · ${data.kind.campaign} lead calls`}
                />
                <Metric
                  label="Conversations"
                  value={data.status.completed}
                  detail="Calls completed by the agent"
                />
                <Metric
                  label="Completion rate"
                  value={data.completionRate === null ? "—" : `${data.completionRate}%`}
                  detail="Of finished calls in this period"
                />
                <Metric
                  label="Average length"
                  value={formatDuration(data.averageDurationSeconds ?? undefined)}
                  detail="Completed calls with a recorded duration"
                />
              </Grid>
            </VStack>
          </Section>

          <Grid columns={{ minWidth: 320, max: 2, repeat: "fit" }} gap={6}>
            <Section variant="muted" padding={6}>
              <VStack gap={5}>
                <VStack gap={1}>
                  <Heading level={2}>Call activity</Heading>
                  <Text color="secondary">Calls started in each part of the selected period.</Text>
                </VStack>
                {data.activity.map(
                  (bucket: {
                    startAt: number;
                    endAt: number;
                    calls: number;
                    completed: number;
                  }) => (
                    <VStack gap={1} key={bucket.startAt}>
                      <HStack justify="between" align="center">
                        <Text type="supporting" color="secondary">
                          {bucketLabel(bucket.startAt, bucket.endAt)}
                        </Text>
                        <Text type="supporting" hasTabularNumbers>
                          {bucket.calls} calls · {bucket.completed} completed
                        </Text>
                      </HStack>
                      <ProgressBar
                        label={`Calls ${bucketLabel(bucket.startAt, bucket.endAt)}`}
                        value={bucket.calls}
                        max={Math.max(
                          1,
                          ...data.activity.map((item: { calls: number }) => item.calls),
                        )}
                        isLabelHidden
                      />
                    </VStack>
                  ),
                )}
              </VStack>
            </Section>

            <Section variant="transparent" padding={0}>
              <VStack gap={5}>
                <VStack gap={1}>
                  <Heading level={2}>Outcomes</Heading>
                  <Text color="secondary">Current status of calls started in this period.</Text>
                </VStack>
                {(
                  [
                    ["Completed", data.status.completed, "success"],
                    ["No answer", data.status.no_answer, "warning"],
                    ["Failed", data.status.failed, "error"],
                    ["In progress", data.status.in_progress, "accent"],
                    ["Queued", data.status.queued, "neutral"],
                  ] as const
                ).map(([label, count, variant]) => (
                  <VStack gap={1} key={label}>
                    <HStack gap={2} align="center" justify="between">
                      <HStack gap={2} align="center">
                        <StatusDot variant={variant} label={label} />
                        <Text>{label}</Text>
                      </HStack>
                      <Text hasTabularNumbers>{count}</Text>
                    </HStack>
                    <ProgressBar
                      label={label}
                      value={count}
                      max={Math.max(data.totalCalls, 1)}
                      variant={variant}
                      isLabelHidden
                    />
                  </VStack>
                ))}
                <Text type="supporting" color="secondary">
                  {data.followUps} finished calls flagged for follow-up
                </Text>
              </VStack>
            </Section>
          </Grid>

          <Section variant="transparent" padding={0} paddingInline={8}>
            <VStack gap={4}>
              <HStack justify="between" align="center" wrap="wrap">
                <Heading level={2}>From call to follow-up</Heading>
                <Link href="/calls" isStandalone>
                  Review calls
                </Link>
              </HStack>
              <Grid columns={{ minWidth: 220, max: 3, repeat: "fit" }} gap={4}>
                <Metric
                  label="Leads in workspace"
                  value={leads.total}
                  detail={`${leads.called} have been called · all time`}
                />
                <Metric
                  label="Needs attention"
                  value={data.followUps}
                  detail="Agent marked a follow-up"
                />
                <Metric
                  label="Saved to Twenty"
                  value={data.crm.synced}
                  detail={`${data.crm.failed} sync failures in this period`}
                />
              </Grid>
              <Text type="supporting" color="secondary">
                Lead totals cover the whole workspace; call and CRM totals follow the selected
                period.
              </Text>
            </VStack>
          </Section>
        </>
      )}
    </VStack>
  );
}
