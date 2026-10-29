import type { Attachment, Message, SubmissionReceipt } from "@ds-bot/mobile-sdk";

/**
 * Durable outgoing messages, one FIFO per conversation.
 *
 *   queued -> sending -> sent            (host accepted; kept until the transcript row arrives)
 *                     -> queued          (transport failed; retried with backoff)
 *                     -> unconfirmed     (auto retries spent or the host's answer is unknown; manual retry)
 *                     -> rejected        (host refused; manual retry creates nothing, discard or edit)
 *
 * `requestId` is the idempotency key. A retry first asks the host for the receipt and only
 * submits when the host answers 404, so a lost response can never produce a duplicate.
 */
export type OutboxState = "queued" | "sending" | "sent" | "unconfirmed" | "rejected";
export interface OutboxItem {
  requestId: string;
  conversationId: string;
  text: string;
  attachments: Attachment[];
  createdAt: number;
  state: OutboxState;
  attempts: number;
  /** Earliest time of the next automatic attempt. */
  retryAt?: number;
  deviceId?: string;
  sessionId?: string;
  error?: string;
}
export interface OutboxStore {
  load(): Promise<OutboxItem[]>;
  save(items: OutboxItem[]): Promise<void>;
}
export interface OutboxTransport {
  deviceId(): Promise<string | undefined>;
  target(conversationId: string): Promise<{ sessionId: string }>;
  submission(requestId: string): Promise<SubmissionReceipt>;
  submit(submission: { conversationId: string; sessionId: string; requestId: string; text: string; attachments?: Attachment[] }): Promise<SubmissionReceipt>;
  remember?(submission: { conversationId: string; sessionId: string; requestId: string; text: string; attachments?: Attachment[] }, receipt: SubmissionReceipt): Promise<void>;
}
export interface OutboxOptions {
  store: OutboxStore;
  transport: () => OutboxTransport | null;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  random?: () => number;
  newId: () => string;
  maxAutoAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const status = (error: unknown) => typeof error === "object" && error !== null && "status" in error ? Number((error as { status: unknown }).status) : undefined;
const REJECTED = [400, 404, 409, 413, 415, 422];
// 404 from the receipt lookup means "not seen"; from submit it means the target vanished.
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

export function createOutbox(options: OutboxOptions) {
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const random = options.random ?? Math.random;
  const maxAuto = options.maxAutoAttempts ?? 6;
  const base = options.baseDelayMs ?? 1000, cap = options.maxDelayMs ?? 15000;
  let items: OutboxItem[] = [];
  let loaded: Promise<void> | undefined;
  let timer: unknown;
  let version = 0;
  const running = new Set<string>();
  const listeners = new Set<() => void>();
  let writes: Promise<void> = Promise.resolve();

  const emit = () => { version++; for (const listener of [...listeners]) listener(); };
  const persist = () => {
    const snapshot = items.map(item => ({ ...item }));
    writes = writes.then(() => options.store.save(snapshot)).catch(() => {});
    return writes;
  };
  const patch = (requestId: string, change: Partial<OutboxItem>) => {
    items = items.map(item => item.requestId === requestId ? { ...item, ...change } : item);
    emit();
    return persist();
  };
  const find = (requestId: string) => items.find(item => item.requestId === requestId);
  function load() {
    loaded ??= options.store.load().then(saved => {
      // Whatever was in flight when the app died is uncertain, not failed: reconcile by receipt.
      items = saved.map(item => item.state === "sending" ? { ...item, state: "queued" as const, retryAt: undefined } : item);
      emit();
    }).catch(() => { loaded = undefined; });
    return loaded;
  }
  function arm() {
    clearTimer(timer);
    timer = undefined;
    const waiting = items.filter(item => item.state === "queued" && item.retryAt && item.retryAt > now());
    if (!waiting.length) return;
    const at = Math.min(...waiting.map(item => item.retryAt!));
    timer = setTimer(() => { timer = undefined; void flush(); }, Math.max(1, at - now()));
  }
  async function deliver(item: OutboxItem) {
    const transport = options.transport();
    if (!transport) { await patch(item.requestId, { state: "queued" }); return; }
    await patch(item.requestId, { state: "sending", error: undefined });
    try {
      const deviceId = await transport.deviceId();
      if (!deviceId) throw Object.assign(new Error("This device is not paired. Reconnect in Settings."), { status: 401 });
      if (item.deviceId && item.deviceId !== deviceId)
        throw Object.assign(new Error("This send belongs to a previous device pairing. Review it on your host."), { status: 409 });
      const sessionId = item.sessionId ?? (await transport.target(item.conversationId)).sessionId;
      const submission = { conversationId: item.conversationId, sessionId, requestId: item.requestId, text: item.text, attachments: item.attachments };
      await patch(item.requestId, { deviceId, sessionId });
      let receipt: SubmissionReceipt;
      try { receipt = await transport.submission(item.requestId); }
      catch (error) { if (status(error) !== 404) throw error; receipt = await transport.submit(submission); }
      if (receipt.status === "rejected") { await patch(item.requestId, { state: "rejected", error: "The host rejected this message." }); return; }
      if (receipt.status !== "accepted") { await patch(item.requestId, { state: "unconfirmed", error: "The host has not confirmed this message yet." }); return; }
      void transport.remember?.(submission, receipt)?.catch(() => {});
      await patch(item.requestId, { state: "sent", error: undefined, retryAt: undefined });
    } catch (error) {
      const code = status(error);
      if (code !== undefined && REJECTED.includes(code)) { await patch(item.requestId, { state: "rejected", error: message(error) }); return; }
      const attempts = item.attempts + 1;
      if (attempts >= maxAuto || code === 401 || code === 403) { await patch(item.requestId, { state: "unconfirmed", attempts, error: message(error) }); return; }
      // Full jitter below an exponential ceiling, capped at 15 seconds.
      const delay = Math.max(250, Math.round(Math.min(cap, base * 2 ** (attempts - 1)) * (0.5 + random() / 2)));
      await patch(item.requestId, { state: "queued", attempts, error: message(error), retryAt: now() + delay });
    }
  }
  async function pump(conversationId: string) {
    if (running.has(conversationId)) return;
    running.add(conversationId);
    try {
      for (;;) {
        // FIFO: an item that is waiting, unconfirmed or rejected blocks the ones behind it,
        // so messages are never delivered out of order.
        const head = items.find(item => item.conversationId === conversationId && item.state !== "sent");
        if (!head || head.state !== "queued" || (head.retryAt && head.retryAt > now())) return;
        await deliver(head);
      }
    } finally { running.delete(conversationId); }
  }
  async function flush(conversationId?: string) {
    await load();
    const ids = conversationId ? [conversationId] : [...new Set(items.map(item => item.conversationId))];
    await Promise.all(ids.map(pump));
    arm();
  }
  return {
    load,
    list: (conversationId?: string) => items.filter(item => !conversationId || item.conversationId === conversationId),
    get version() { return version; },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async enqueue(input: { conversationId: string; text: string; attachments?: Attachment[] }) {
      await load();
      const text = input.text.trim(), attachments = input.attachments ?? [];
      if (!text && !attachments.length) return null;
      const item: OutboxItem = { requestId: options.newId(), conversationId: input.conversationId, text, attachments, createdAt: now(), state: "queued", attempts: 0 };
      items = [...items, item];
      emit();
      await persist();
      void flush(item.conversationId);
      return item;
    },
    /** Manual retry of an unconfirmed item. A rejected item is final; discard it instead. */
    async retry(requestId: string) {
      await load();
      const item = find(requestId);
      if (!item || item.state !== "unconfirmed") return;
      await patch(requestId, { state: "queued", attempts: 0, retryAt: undefined, error: undefined });
      void flush(item.conversationId);
    },
    async discard(requestId: string) {
      await load();
      const item = find(requestId);
      if (!item || item.state === "sending" || item.state === "sent") return;
      items = items.filter(other => other.requestId !== requestId);
      emit();
      await persist();
      void flush(item.conversationId);
    },
    /** Drop accepted items whose canonical transcript row has arrived. */
    async settle(conversationId: string, transcript: Pick<Message, "requestId">[]) {
      await load();
      const seen = new Set(transcript.map(row => row.requestId).filter(Boolean));
      const next = items.filter(item => !(item.conversationId === conversationId && item.state === "sent" && seen.has(item.requestId)));
      if (next.length === items.length) return;
      items = next;
      emit();
      await persist();
    },
    /** Network or foreground recovery: ignore backoff and try everything that is queued. */
    async resume() {
      await load();
      items = items.map(item => item.state === "queued" ? { ...item, retryAt: undefined } : item);
      await flush();
    },
    dispose() { clearTimer(timer); listeners.clear(); },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;
