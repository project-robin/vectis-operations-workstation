import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { TwentyAdapter } from "../../../src/server/adapters/twenty/adapter.js";

describe("Twenty adapter", () => {
  it("creates one contact-linked call note and repairs retries without duplicates", async () => {
    const personId = randomUUID();
    const noteId = randomUUID();
    const targetId = randomUUID();
    let noteExists = false;
    let targetExists = false;
    const execute = vi.fn(async (toolName: string) => {
      if (toolName === "find_many_people") {
        return { success: true, result: { records: [{ id: personId }] } };
      }
      if (toolName === "find_many_notes") {
        return {
          success: true,
          result: { records: noteExists ? [{ id: noteId }] : [] },
        };
      }
      if (toolName === "create_one_note") {
        noteExists = true;
        return { success: true, result: { record: { id: noteId } } };
      }
      if (toolName === "find_many_note_targets") {
        return {
          success: true,
          result: { records: targetExists ? [{ id: targetId }] : [] },
        };
      }
      if (toolName === "create_one_note_target") {
        targetExists = true;
        return { success: true, result: { record: { id: targetId } } };
      }
      throw new Error(`Unexpected Twenty tool ${toolName}`);
    });
    const adapter = new TwentyAdapter(execute);
    const input = {
      phone: "+447700900123",
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
      providerRunId: randomUUID(),
      state: "completed" as const,
      gatheredContext: { lead_status: "qualified" },
      recordingUrl: "https://example.test/recording",
      transcriptUrl: null,
    };

    await adapter.syncCallOutcome(input, "delivery-key");
    await adapter.syncCallOutcome(input, "delivery-key");

    expect(execute.mock.calls.filter(([tool]) => tool === "create_one_note")).toHaveLength(1);
    expect(execute.mock.calls.filter(([tool]) => tool === "create_one_note_target")).toHaveLength(
      1,
    );
    expect(execute).toHaveBeenCalledWith(
      "find_many_notes",
      expect.objectContaining({ title: { eq: "[Vectis delivery-key] Dograh call outcome" } }),
    );
    expect(execute).toHaveBeenCalledWith(
      "create_one_note_target",
      expect.objectContaining({ noteId, targetPersonId: personId }),
    );
  });
});
