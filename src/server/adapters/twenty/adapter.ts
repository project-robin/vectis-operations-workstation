import { z } from "zod";

const outcomeSchema = z.object({
  phone: z.string().min(1),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  email: z.email().nullable(),
  providerRunId: z.uuid(),
  state: z.enum(["completed", "failed"]),
  gatheredContext: z.record(z.string(), z.unknown()),
  recordingUrl: z.url().nullable(),
  transcriptUrl: z.url().nullable(),
});

const recordsSchema = z.object({
  success: z.literal(true),
  result: z.object({ records: z.array(z.object({ id: z.uuid() })) }),
});

function createdId(result: unknown): string {
  const envelope = z
    .object({ success: z.literal(true), result: z.record(z.string(), z.unknown()) })
    .parse(result);
  const record = "record" in envelope.result ? envelope.result.record : envelope.result;
  return z.object({ id: z.uuid() }).parse(record).id;
}

export class TwentyAdapter {
  readonly #execute: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;

  constructor(execute: (toolName: string, args: Record<string, unknown>) => Promise<unknown>) {
    this.#execute = execute;
  }

  async syncCallOutcome(rawInput: z.input<typeof outcomeSchema>, idempotencyKey: string) {
    const input = outcomeSchema.parse(rawInput);
    const title = `[Vectis ${idempotencyKey}] Dograh call outcome`;
    const notes = recordsSchema.parse(
      await this.#execute("find_many_notes", {
        select: ["id"],
        title: { eq: title },
        limit: 1,
      }),
    ).result.records;
    const people = recordsSchema.parse(
      await this.#execute("find_many_people", {
        select: ["id"],
        phones: { primaryPhoneNumber: { ilike: `%${input.phone.replace(/\D/g, "").slice(-10)}%` } },
        limit: 2,
      }),
    ).result.records;
    if (people.length > 1) {
      throw new Error("Twenty phone lookup is ambiguous");
    }

    const personId = people[0]?.id ?? (await this.#createPerson(input));
    const noteId = notes[0]?.id ?? (await this.#createNote(title, input));
    const targets = recordsSchema.parse(
      await this.#execute("find_many_note_targets", {
        select: ["id"],
        noteId: { eq: noteId },
        targetPersonId: { eq: personId },
        limit: 1,
      }),
    ).result.records;
    if (targets.length === 0) {
      await this.#execute("create_one_note_target", {
        position: "first",
        noteId,
        targetPersonId: personId,
      });
    }
  }

  async #createPerson(input: z.output<typeof outcomeSchema>): Promise<string> {
    const result = await this.#execute("create_one_person", {
      position: "first",
      name: { firstName: input.firstName, lastName: input.lastName },
      phones: { primaryPhoneNumber: input.phone },
      ...(input.email ? { emails: { primaryEmail: input.email } } : {}),
    });
    return createdId(result);
  }

  async #createNote(title: string, input: z.output<typeof outcomeSchema>): Promise<string> {
    const body = [
      `**State:** ${input.state}`,
      `**Provider run:** ${input.providerRunId}`,
      input.recordingUrl ? `**Recording:** ${input.recordingUrl}` : "",
      input.transcriptUrl ? `**Transcript:** ${input.transcriptUrl}` : "",
      "",
      "```json",
      JSON.stringify(input.gatheredContext, null, 2),
      "```",
    ]
      .filter(Boolean)
      .join("\n");
    return createdId(
      await this.#execute("create_one_note", {
        position: "first",
        title,
        bodyV2: { markdown: body },
      }),
    );
  }
}
