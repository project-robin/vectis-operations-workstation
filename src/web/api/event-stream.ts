export interface EventSourceLike {
  onerror: (() => void) | null;
  onopen: (() => void) | null;
  addEventListener(type: string, listener: () => void): void;
  close(): void;
}

export type EventSourceFactory = (url: string) => EventSourceLike;

export interface EventStreamCallbacks {
  onConnected: () => void;
  onDisconnected: () => void;
  onHealthChanged: () => void;
}

export function connectEventStream(
  organizationId: string,
  callbacks: EventStreamCallbacks,
  factory: EventSourceFactory,
): () => void {
  const source = factory(`/api/events?organizationId=${encodeURIComponent(organizationId)}`);
  source.onopen = callbacks.onConnected;
  source.onerror = callbacks.onDisconnected;
  source.addEventListener("health.checked", callbacks.onHealthChanged);

  return () => source.close();
}
