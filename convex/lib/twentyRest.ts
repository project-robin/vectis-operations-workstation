import { splitForTwenty } from "./phone";

/**
 * Minimal Twenty CRM REST client for the calling console: find/create people,
 * attach call notes, and open follow-up tasks. Deterministic REST (not MCP)
 * because every write here is a fixed, idempotency-checked operation.
 */
export type TwentyPerson = { id: string; name: string; phone?: string; email?: string };

export class TwentyError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "TwentyError";
  }
}

const TIMEOUT_MS = 15_000;

function personName(value: unknown): string {
  const name = value && typeof value === "object" ? (value as { firstName?: string; lastName?: string }) : {};
  return [name.firstName, name.lastName].filter((part) => part && part.trim()).join(" ").trim();
}

function personPhone(value: unknown): string | undefined {
  const phones = value && typeof value === "object" ? (value as Record<string, string | undefined>) : {};
  const number = phones.primaryPhoneNumber?.replace(/[^\d]/g, "");
  if (!number) return undefined;
  const code = (phones.primaryPhoneCallingCode ?? "").replace(/[^\d]/g, "");
  return `+${code}${number}`;
}

export function splitName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "Unknown", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export class TwentyRestClient {
  private readonly base: string;
  constructor(baseUrl: string, private readonly apiKey: string, private readonly fetcher: typeof fetch = fetch) {
    if (!/^https?:\/\//i.test(baseUrl) || !apiKey) throw new Error("Twenty client requires a base URL and API key");
    this.base = baseUrl.replace(/\/+$/, "").replace(/\/rest$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetcher(`${this.base}/rest${path}`, {
        ...init,
        signal: controller.signal,
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json", ...(init.headers ?? {}) },
      });
      const body = await response.text();
      if (!response.ok) {
        const hint = response.status === 401 ? " (Twenty API key is invalid or expired)" : "";
        throw new TwentyError(`Twenty ${init.method ?? "GET"} ${path.split("?")[0]} failed: ${response.status}${hint} ${body.slice(0, 200)}`, response.status);
      }
      return (body ? JSON.parse(body) : {}) as T;
    } catch (error) {
      if (error instanceof TwentyError) throw error;
      throw new TwentyError(`Twenty request failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private static toPerson(row: Record<string, unknown>): TwentyPerson {
    const emails = row.emails && typeof row.emails === "object" ? (row.emails as { primaryEmail?: string }) : {};
    return {
      id: String(row.id),
      name: personName(row.name) || "Unnamed contact",
      phone: personPhone(row.phones),
      email: emails.primaryEmail || undefined,
    };
  }

  async findPersonByPhone(e164: string): Promise<TwentyPerson | null> {
    const { number } = splitForTwenty(e164);
    const filter = encodeURIComponent(`phones.primaryPhoneNumber[eq]:"${number}"`);
    const body = await this.request<{ data?: { people?: Record<string, unknown>[] } }>(`/people?filter=${filter}&limit=5`);
    const people = (body.data?.people ?? []).map(TwentyRestClient.toPerson);
    return people.find((person) => person.phone === e164) ?? people[0] ?? null;
  }

  async createPerson(args: { name: string; phone: string; email?: string }): Promise<TwentyPerson> {
    const { callingCode, number } = splitForTwenty(args.phone);
    const body = await this.request<{ data?: { createPerson?: Record<string, unknown> } }>("/people", {
      method: "POST",
      body: JSON.stringify({
        name: splitName(args.name),
        phones: { primaryPhoneNumber: number, primaryPhoneCallingCode: callingCode },
        ...(args.email ? { emails: { primaryEmail: args.email } } : {}),
      }),
    });
    const created = body.data?.createPerson;
    if (!created?.id) throw new TwentyError("Twenty createPerson returned no id");
    return TwentyRestClient.toPerson(created);
  }

  async upsertPerson(args: { name: string; phone: string; email?: string }): Promise<TwentyPerson> {
    return (await this.findPersonByPhone(args.phone)) ?? this.createPerson(args);
  }

  async listPeople(cursor?: string, limit = 60): Promise<{ people: TwentyPerson[]; nextCursor?: string }> {
    const query = `?limit=${limit}${cursor ? `&starting_after=${encodeURIComponent(cursor)}` : ""}`;
    const body = await this.request<{
      data?: { people?: Record<string, unknown>[] };
      pageInfo?: { hasNextPage?: boolean; endCursor?: string };
    }>(`/people${query}`);
    return {
      people: (body.data?.people ?? []).map(TwentyRestClient.toPerson),
      nextCursor: body.pageInfo?.hasNextPage ? body.pageInfo.endCursor : undefined,
    };
  }

  async createNoteForPerson(personId: string, title: string, markdown: string): Promise<string> {
    const body = await this.request<{ data?: { createNote?: { id?: string } } }>("/notes", {
      method: "POST",
      body: JSON.stringify({ title: title.slice(0, 250), bodyV2: { markdown } }),
    });
    const noteId = body.data?.createNote?.id;
    if (!noteId) throw new TwentyError("Twenty createNote returned no id");
    await this.request("/noteTargets", { method: "POST", body: JSON.stringify({ noteId, targetPersonId: personId }) });
    return noteId;
  }

  async createTaskForPerson(personId: string, title: string, markdown: string, dueAt?: string): Promise<string> {
    const body = await this.request<{ data?: { createTask?: { id?: string } } }>("/tasks", {
      method: "POST",
      body: JSON.stringify({ title: title.slice(0, 250), bodyV2: { markdown }, status: "TODO", ...(dueAt ? { dueAt } : {}) }),
    });
    const taskId = body.data?.createTask?.id;
    if (!taskId) throw new TwentyError("Twenty createTask returned no id");
    await this.request("/taskTargets", { method: "POST", body: JSON.stringify({ taskId, targetPersonId: personId }) });
    return taskId;
  }

  async ping(): Promise<void> {
    await this.request("/people?limit=1");
  }
}
