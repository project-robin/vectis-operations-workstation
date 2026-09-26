export const WORK_ITEM_TYPES = ["dispute", "handoff", "follow_up", "escalation"] as const;
export type WorkItemType = (typeof WORK_ITEM_TYPES)[number];
export const WORK_ITEM_STATUSES = ["open", "assigned", "investigating", "waiting_for_customer", "resolved"] as const;
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number];
export const WORK_ITEM_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type WorkItemPriority = (typeof WORK_ITEM_PRIORITIES)[number];

export const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, readonly WorkItemStatus[]> = {
  open: ["open", "assigned"],
  assigned: ["assigned", "open", "investigating"],
  investigating: ["investigating", "assigned", "waiting_for_customer", "resolved"],
  waiting_for_customer: ["waiting_for_customer", "investigating", "resolved"],
  resolved: ["resolved"],
};

export type EvidenceLink = { table: string; id: string; label?: string };
export type FollowUpProposal = { note: string; dueAt?: number; proposedAt: number; proposedBy: string };

export function assertWorkItemTransition(from: WorkItemStatus, to: WorkItemStatus): void {
  if (!WORK_ITEM_TRANSITIONS[from]?.includes(to)) throw new Error(`Illegal work item transition: ${from} -> ${to}`);
}

export function assertResolution(resolution: string | undefined): asserts resolution is string {
  if (!resolution || resolution.trim().length === 0) throw new Error("Resolving requires a resolution note");
  if (resolution.length > 4_000) throw new Error("Resolution note is too long");
}
