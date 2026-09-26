"use client";

import { Heading } from "@astryxdesign/core/Heading";
import { Section } from "@astryxdesign/core/Section";
import { HStack, VStack } from "@astryxdesign/core/Stack";
import { StatusDot } from "@astryxdesign/core/StatusDot";
import { Text } from "@astryxdesign/core/Text";
import type { ReactNode } from "react";

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const CALL_STATUS: Record<string, [string, Tone]> = {
  queued: ["Queued", "neutral"],
  in_progress: ["Calling", "info"],
  completed: ["Completed", "success"],
  no_answer: ["No answer", "warning"],
  failed: ["Failed", "danger"],
};

const LEAD_STATUS: Record<string, [string, Tone]> = {
  new: ["Not called", "neutral"],
  queued: ["In a campaign", "info"],
  called: ["Called", "success"],
  failed: ["Needs retry", "warning"],
};

const CRM_STATUS: Record<string, [string, Tone]> = {
  pending: ["Pending", "neutral"],
  synced: ["In CRM", "success"],
  failed: ["CRM error", "danger"],
  skipped: ["Not synced", "neutral"],
};

const BATCH_STATUS: Record<string, [string, Tone]> = {
  creating: ["Starting", "info"],
  running: ["Running", "info"],
  paused: ["Paused", "warning"],
  completed: ["Finished", "success"],
  failed: ["Failed", "danger"],
};

const STATUS_VARIANT = {
  neutral: "neutral",
  info: "accent",
  success: "success",
  warning: "warning",
  danger: "error",
} as const;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <HStack gap={2} align="center">
      <StatusDot variant={STATUS_VARIANT[tone]} label={String(children)} />
      <Text type="supporting">{children}</Text>
    </HStack>
  );
}

function lookup(table: Record<string, [string, Tone]>, value: string) {
  const [label, tone] = table[value] ?? [value, "neutral" as Tone];
  return <Badge tone={tone}>{label}</Badge>;
}

export const CallStatusBadge = ({ status }: { status: string }) => lookup(CALL_STATUS, status);
export const LeadStatusBadge = ({ status }: { status: string }) => lookup(LEAD_STATUS, status);
export const CrmStatusBadge = ({ status }: { status: string }) => lookup(CRM_STATUS, status);
export const BatchStatusBadge = ({ status }: { status: string }) => lookup(BATCH_STATUS, status);

export function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null) return "—";
  const minutes = Math.floor(seconds / 60);
  return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

export function formatWhen(timestamp?: number): string {
  if (!timestamp) return "—";
  const diff = Date.now() - timestamp;
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} min ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} h ago`;
  return new Date(timestamp).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <VStack gap={1} padding={4}>
      <HStack gap={2} align="center">
        {tone && tone !== "neutral" ? (
          <StatusDot variant={STATUS_VARIANT[tone]} label={label} />
        ) : null}
        <Text type="supporting" color="secondary">
          {label}
        </Text>
      </HStack>
      <Text type="display-3" display="block" hasTabularNumbers>
        {value}
      </Text>
      {hint ? (
        <Text type="supporting" color="secondary" display="block">
          {hint}
        </Text>
      ) : null}
    </VStack>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <Section variant="transparent" padding={0} paddingInline={8} paddingBlockEnd={6}>
      <HStack gap={4} align="center" justify="between" wrap="wrap" as="header">
        <VStack gap={1}>
          <Heading level={1} type="display-3">
            {title}
          </Heading>
          {subtitle ? (
            <Text color="secondary" display="block">
              {subtitle}
            </Text>
          ) : null}
        </VStack>
        {actions ? (
          <HStack gap={2} wrap="wrap">
            {actions}
          </HStack>
        ) : null}
      </HStack>
    </Section>
  );
}

export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  // Convex wraps server errors as "[CONVEX M(...)] ... Uncaught Error: <message>"
  const match = text.match(/Uncaught Error: ([^\n]+)/);
  return (match ? match[1] : text).replace(/\s+at .*$/s, "").trim();
}
