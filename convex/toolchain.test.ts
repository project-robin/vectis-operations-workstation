import type { GenericId } from "convex/values";
import { convexTest, type TestConvex } from "convex-test";
import { expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { MAX_SCHEDULED_ECHOES_PER_ORGANIZATION } from "./toolchain";

const modules = import.meta.glob("./**/*.*s");

const ownerClaims = {
  subject: "task2-owner",
  name: "Owner",
  org_id: "org_task2",
  org_role: "org:admin",
};
const secondOwnerClaims = {
  subject: "task2-second-owner",
  name: "Second owner",
  org_id: "org_task2_second",
  org_role: "org:admin",
};
const TERMINAL_RETENTION_LIMIT = 100;

async function insertScheduledEchoes(
  t: TestConvex<typeof schema>,
  organizationId: GenericId<"organizations">,
  count: number,
  status: "completed" | "failed" | "pending",
  startAt = 1,
) {
  return t.run(async (ctx) => {
    const ids = [];
    for (let index = 0; index < count; index += 1) {
      ids.push(
        await ctx.db.insert("scheduledEchoes", {
          organizationId,
          payload: `${status}-${index}`,
          status,
          createdAt: startAt + index,
          ...(status === "pending" ? {} : { finishedAt: startAt + index }),
        }),
      );
    }
    return ids;
  });
}

async function countScheduledEchoes(
  t: TestConvex<typeof schema>,
  organizationId: GenericId<"organizations">,
  status: "completed" | "failed" | "pending",
) {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("scheduledEchoes")
          .withIndex("by_organization_status", (q) =>
            q.eq("organizationId", organizationId).eq("status", status),
          )
          .take(TERMINAL_RETENTION_LIMIT + 10)
      ).length,
  );
}

async function countTerminalScheduledEchoes(
  t: TestConvex<typeof schema>,
  organizationId: GenericId<"organizations">,
) {
  return t.run(
    async (ctx) =>
      (
        await ctx.db
          .query("scheduledEchoes")
          .withIndex("by_organization_status", (q) => q.eq("organizationId", organizationId))
          .filter((q) =>
            q.or(q.eq(q.field("status"), "completed"), q.eq(q.field("status"), "failed")),
          )
          .collect()
      ).length,
  );
}

async function provisionOwner(t: ReturnType<typeof convexTest>, claims = ownerClaims) {
  const owner = t.withIdentity(claims);
  const event = async (eventId: string, eventType: string, data: object) =>
    t.mutation(internal.http.clerkWebhook.processEvent, {
      eventId,
      eventType,
      payload: JSON.stringify({ id: eventId, type: eventType, data }),
      eventTimestamp: 1_000,
    });
  await event(`${claims.subject}-created`, "user.created", { id: claims.subject });
  await event(`${claims.org_id}-created`, "organization.created", {
    id: claims.org_id,
    name: claims.org_id,
  });
  await event(`${claims.subject}-${claims.org_id}-membership`, "organizationMembership.created", {
    id: `${claims.subject}-${claims.org_id}-membership`,
    organization: { id: claims.org_id },
    public_user_data: { user_id: claims.subject },
    role: "org:admin",
  });
  return owner;
}

test("unauthenticated probe access is rejected", async () => {
  const t = convexTest(schema, modules);
  await expect(t.query(api.toolchain.probeCount, {})).rejects.toThrow(/unauthenticated/i);
  await expect(t.mutation(api.toolchain.recordProbe, { label: "blocked" })).rejects.toThrow(
    /unauthenticated/i,
  );
});

test("a member can query and record only its tenant's probes", async () => {
  const t = convexTest(schema, modules);
  const firstOwner = await provisionOwner(t);
  const secondOwner = await provisionOwner(t, secondOwnerClaims);
  await firstOwner.mutation(api.toolchain.recordProbe, { label: "boot" });
  await secondOwner.mutation(api.toolchain.recordProbe, { label: "other-tenant" });
  expect(await firstOwner.query(api.toolchain.probeCount, {})).toBe(1);
  expect(await secondOwner.query(api.toolchain.probeCount, {})).toBe(1);
});

test("probe cleanup is tenant-scoped and removes only the requested probe", async () => {
  const t = convexTest(schema, modules);
  const firstOwner = await provisionOwner(t);
  const secondOwner = await provisionOwner(t, secondOwnerClaims);
  const firstProbe = await firstOwner.mutation(api.toolchain.recordProbe, { label: "protected" });
  await secondOwner.mutation(api.toolchain.recordProbe, { label: "protected" });

  await expect(
    secondOwner.mutation(api.toolchain.removeProbe, { probeId: firstProbe }),
  ).rejects.toThrow(/forbidden|not found/i);
  await expect(t.mutation(api.toolchain.removeProbe, { probeId: firstProbe })).rejects.toThrow(
    /unauthenticated/i,
  );
  await firstOwner.mutation(api.toolchain.removeProbe, { probeId: firstProbe });
  expect(await firstOwner.query(api.toolchain.probeCount, {})).toBe(0);
  expect(await secondOwner.query(api.toolchain.probeCount, {})).toBe(1);
});

test("toolchain labels and payloads are bounded", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  await expect(
    owner.mutation(api.toolchain.recordProbe, { label: "x".repeat(129) }),
  ).rejects.toThrow(/label.*128/i);
  await expect(
    owner.mutation(api.toolchain.scheduleEcho, { payload: "x".repeat(257) }),
  ).rejects.toThrow(/payload.*256/i);
  await expect(
    owner.mutation(api.toolchain.scheduleEcho, { payload: "x".repeat(124) }),
  ).rejects.toThrow(/label.*128/i);
});

test("the per-tenant probe quota prevents unbounded retention", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  for (let i = 0; i < 100; i += 1) {
    await owner.mutation(api.toolchain.recordProbe, { label: `probe-${i}` });
  }
  await expect(owner.mutation(api.toolchain.recordProbe, { label: "over-quota" })).rejects.toThrow(
    /quota/i,
  );
  expect(await owner.query(api.toolchain.probeCount, {})).toBe(100);
});

test("scheduled internal action executes for the requesting tenant", async () => {
  const t = convexTest(schema, modules);
  const authenticated = await provisionOwner(t);
  await authenticated.mutation(api.toolchain.scheduleEcho, { payload: "hi" });
  await t.finishAllScheduledFunctions(() => {});
  const probes = await authenticated.query(api.toolchain.probeCount, {});
  expect(probes).toBe(1);
});

test("scheduled echo has a finite per-tenant in-flight quota", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);

  await Promise.all(
    Array.from({ length: MAX_SCHEDULED_ECHOES_PER_ORGANIZATION }, (_, index) =>
      owner.mutation(api.toolchain.scheduleEcho, { payload: `queued-${index}` }),
    ),
  );
  await expect(
    owner.mutation(api.toolchain.scheduleEcho, { payload: "over-limit" }),
  ).rejects.toThrow(/scheduled echo quota/i);
});

test("scheduled echo quota is isolated by tenant", async () => {
  const t = convexTest(schema, modules);
  const firstOwner = await provisionOwner(t);
  const secondOwner = await provisionOwner(t, secondOwnerClaims);

  await Promise.all(
    Array.from({ length: MAX_SCHEDULED_ECHOES_PER_ORGANIZATION }, (_, index) =>
      firstOwner.mutation(api.toolchain.scheduleEcho, { payload: `first-${index}` }),
    ),
  );
  await expect(
    firstOwner.mutation(api.toolchain.scheduleEcho, { payload: "first-over-limit" }),
  ).rejects.toThrow(/scheduled echo quota/i);
  await expect(
    secondOwner.mutation(api.toolchain.scheduleEcho, { payload: "second-tenant" }),
  ).resolves.toBeDefined();
});

test("scheduled echo releases its slot after successful completion", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);

  const scheduleId = await owner.mutation(api.toolchain.scheduleEcho, { payload: "first" });
  await t.finishAllScheduledFunctions(() => {});
  await expect(
    t.run(async (ctx) => (await ctx.db.get(scheduleId as GenericId<"scheduledEchoes">))?.status),
  ).resolves.toBe("completed");
  await expect(
    owner.mutation(api.toolchain.scheduleEcho, { payload: "second" }),
  ).resolves.toBeDefined();
});

test("scheduled echo releases its slot after action failure", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  for (let index = 0; index < 100; index += 1) {
    await owner.mutation(api.toolchain.recordProbe, { label: `existing-${index}` });
  }

  const scheduleId = await owner.mutation(api.toolchain.scheduleEcho, {
    payload: "fails-at-probe-quota",
  });
  await t.finishAllScheduledFunctions(() => {});
  await expect(
    t.run(async (ctx) => (await ctx.db.get(scheduleId as GenericId<"scheduledEchoes">))?.status),
  ).resolves.toBe("failed");
  await expect(
    owner.mutation(api.toolchain.scheduleEcho, { payload: "slot-was-released" }),
  ).resolves.toBeDefined();
});

test("repeated completion keeps terminal scheduled echoes within the retention bound", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT + 5, "completed");
  const pendingId = await insertScheduledEchoes(t, organizationId, 1, "pending", 1000).then(
    ([id]) => id,
  );

  await t.mutation(internal.toolchain.finalizeSchedule, {
    organizationId,
    scheduleId: pendingId,
    status: "completed",
  });
  await t.mutation(internal.toolchain.finalizeSchedule, {
    organizationId,
    scheduleId: pendingId,
    status: "completed",
  });

  expect(await countScheduledEchoes(t, organizationId, "completed")).toBeLessThanOrEqual(
    TERMINAL_RETENTION_LIMIT,
  );
  await expect(t.run(async (ctx) => (await ctx.db.get(pendingId))?.status)).resolves.toBe(
    "completed",
  );
});

test("the scheduled echo sweep removes terminal rows in bounded batches without deleting pending work", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT + 10, "failed");
  const pendingId = await insertScheduledEchoes(t, organizationId, 1, "pending", 1000).then(
    ([id]) => id,
  );

  await t.mutation(internal.toolchain.sweep, {});
  await t.finishAllScheduledFunctions(() => {});

  expect(await countScheduledEchoes(t, organizationId, "failed")).toBeLessThanOrEqual(
    TERMINAL_RETENTION_LIMIT,
  );
  await expect(t.run(async (ctx) => (await ctx.db.get(pendingId))?.status)).resolves.toBe(
    "pending",
  );
});

test("the scheduled echo sweep enqueues cleanup transactions capped at 25 deletions", async () => {
  const t = convexTest({ schema, modules, transactionLimits: { documentsWritten: 25 } });
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});

  for (let start = 0; start < 125; start += 25) {
    await t.run(async (ctx) => {
      for (let index = start; index < Math.min(start + 25, 125); index += 1) {
        await ctx.db.insert("scheduledEchoes", {
          organizationId,
          payload: `terminal-${index}`,
          status: "completed",
          createdAt: index + 1,
          finishedAt: index + 1,
        });
      }
    });
  }

  vi.useFakeTimers();
  try {
    await t.mutation(internal.toolchain.sweep, {});
    expect(await countTerminalScheduledEchoes(t, organizationId)).toBe(125);

    await t.finishAllScheduledFunctions(() => vi.runAllTimers());
    expect(await countTerminalScheduledEchoes(t, organizationId)).toBe(100);
  } finally {
    vi.useRealTimers();
  }
});

test("legacy terminal rows without finishedAt remain covered by cleanup", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});
  await t.run(async (ctx) => {
    for (let index = 0; index < TERMINAL_RETENTION_LIMIT + 1; index += 1) {
      await ctx.db.insert("scheduledEchoes", {
        organizationId,
        payload: `legacy-${index}`,
        status: "completed",
        createdAt: index + 1,
      });
    }
  });

  await t.mutation(internal.toolchain.sweep, {});
  await t.finishAllScheduledFunctions(() => {});

  expect(await countScheduledEchoes(t, organizationId, "completed")).toBeLessThanOrEqual(
    TERMINAL_RETENTION_LIMIT,
  );
});

test("terminal retention combines completed and failed rows under one tenant limit", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT, "completed");
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT, "failed", 1000);
  const pendingId = await insertScheduledEchoes(t, organizationId, 1, "pending", 2000).then(
    ([id]) => id,
  );

  await t.mutation(internal.toolchain.sweep, {});
  await t.finishAllScheduledFunctions(() => {});

  expect(await countTerminalScheduledEchoes(t, organizationId)).toBeLessThanOrEqual(
    TERMINAL_RETENTION_LIMIT,
  );
  await expect(t.run(async (ctx) => (await ctx.db.get(pendingId))?.status)).resolves.toBe(
    "pending",
  );
});

test("terminal retention continuations converge in bounded deletion batches", async () => {
  const t = convexTest(schema, modules);
  const owner = await provisionOwner(t);
  const { organizationId } = await owner.query(api.organizations.getCurrent, {});
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT, "completed");
  await insertScheduledEchoes(t, organizationId, TERMINAL_RETENTION_LIMIT, "failed", 1000);

  await t.mutation(internal.toolchain.sweep, {});
  expect(await countTerminalScheduledEchoes(t, organizationId)).toBe(200);

  await t.finishAllScheduledFunctions(() => {});
  expect(await countTerminalScheduledEchoes(t, organizationId)).toBe(TERMINAL_RETENTION_LIMIT);
});

test("scheduled echo sweep rotates through later organizations and wraps safely", async () => {
  const t = convexTest(schema, modules);
  const organizations = await t.run(async (ctx) => {
    const ids = [];
    for (let organizationIndex = 0; organizationIndex < 51; organizationIndex += 1) {
      const organizationId = await ctx.db.insert("organizations", {
        clerkOrgId: `cron-org-${organizationIndex}`,
        name: `Cron org ${organizationIndex}`,
        createdAt: organizationIndex + 1,
      });
      ids.push(organizationId);
      for (let rowIndex = 0; rowIndex <= TERMINAL_RETENTION_LIMIT; rowIndex += 1) {
        await ctx.db.insert("scheduledEchoes", {
          organizationId,
          payload: `terminal-${rowIndex}`,
          status: "completed",
          createdAt: rowIndex + 1,
          finishedAt: rowIndex + 1,
        });
      }
    }
    return ids;
  });

  await expect(t.mutation(internal.toolchain.sweep, {})).resolves.toMatchObject({
    organizationsScanned: 50,
  });
  await t.finishAllScheduledFunctions(() => {});
  expect(await countScheduledEchoes(t, organizations[0], "completed")).toBe(100);
  expect(await countScheduledEchoes(t, organizations[50], "completed")).toBe(101);

  await expect(t.mutation(internal.toolchain.sweep, {})).resolves.toMatchObject({
    organizationsScanned: 1,
  });
  await t.finishAllScheduledFunctions(() => {});
  expect(await countScheduledEchoes(t, organizations[50], "completed")).toBe(100);

  await expect(t.mutation(internal.toolchain.sweep, {})).resolves.toMatchObject({
    organizationsScanned: 50,
  });
});

test("scheduled echo terminal cleanup is isolated by tenant", async () => {
  const t = convexTest(schema, modules);
  const firstOwner = await provisionOwner(t);
  const secondOwner = await provisionOwner(t, secondOwnerClaims);
  const first = await firstOwner.query(api.organizations.getCurrent, {});
  const second = await secondOwner.query(api.organizations.getCurrent, {});
  await insertScheduledEchoes(t, first.organizationId, TERMINAL_RETENTION_LIMIT + 10, "completed");
  await insertScheduledEchoes(t, second.organizationId, 1, "completed", 1000);
  const secondPendingId = await insertScheduledEchoes(
    t,
    second.organizationId,
    1,
    "pending",
    1001,
  ).then(([id]) => id);

  await t.mutation(internal.toolchain.sweep, {});
  await t.finishAllScheduledFunctions(() => {});

  expect(await countScheduledEchoes(t, first.organizationId, "completed")).toBeLessThanOrEqual(
    TERMINAL_RETENTION_LIMIT,
  );
  expect(await countScheduledEchoes(t, second.organizationId, "completed")).toBe(1);
  await expect(t.run(async (ctx) => (await ctx.db.get(secondPendingId))?.status)).resolves.toBe(
    "pending",
  );
});

test("the fetch seam is internal and accepts only a fixed target", async () => {
  const t = convexTest(schema, modules);
  const result = await t.action(internal.nodeActions.fetchText, {
    target: "synthetic",
  });
  expect(result).toEqual({ status: 200, body: "task-2-fetch" });
});

test("HTTP action serves /ping", async () => {
  const t = convexTest(schema, modules);
  const res = await t.fetch("/ping");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, service: "vectis-workstation-convex" });
});
