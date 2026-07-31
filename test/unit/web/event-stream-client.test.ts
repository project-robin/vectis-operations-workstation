import { describe, expect, it, vi } from "vitest";
import { connectEventStream, type EventSourceLike } from "../../../src/web/api/event-stream.js";

class FakeEventSource implements EventSourceLike {
  onerror: (() => void) | null = null;
  onopen: (() => void) | null = null;
  readonly listeners = new Map<string, () => void>();
  close = vi.fn();

  addEventListener(type: string, listener: () => void): void {
    this.listeners.set(type, listener);
  }
}

describe("operation event stream client", () => {
  it("reports connection changes and refreshes health events", () => {
    const source = new FakeEventSource();
    const factory = vi.fn(() => source);
    const onConnected = vi.fn();
    const onDisconnected = vi.fn();
    const onHealthChanged = vi.fn();

    const disconnect = connectEventStream(
      "00000000-0000-4000-8000-000000000001",
      { onConnected, onDisconnected, onHealthChanged },
      factory,
    );

    source.onopen?.();
    source.listeners.get("health.checked")?.();
    source.onerror?.();
    disconnect();

    expect(factory).toHaveBeenCalledWith(
      "/api/events?organizationId=00000000-0000-4000-8000-000000000001",
    );
    expect(onConnected).toHaveBeenCalledOnce();
    expect(onHealthChanged).toHaveBeenCalledOnce();
    expect(onDisconnected).toHaveBeenCalledOnce();
    expect(source.close).toHaveBeenCalledOnce();
  });
});
