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
  /** An initial intent or storage transition whose durable state needs manual reconciliation. */
  persistence?: "unconfirmed";
  /** Earliest time of the next automatic attempt. */
  retryAt?: number;
  deviceId?: string;
  sessionId?: string;
  error?: string;
}
/** A visible pending intent still owns this ID; never replace it with a new send. */
export class OutboxPersistenceError extends Error {
  readonly code = "PERSISTENCE_UNCONFIRMED";
  readonly requestId: string;
  readonly conversationId: string;
  readonly operation: "enqueue" | "retry" | "discard";
  constructor(operation: "enqueue" | "retry" | "discard", item: OutboxItem, cause?: unknown) {
    super("Local message storage is unconfirmed. Retry or discard this pending message.", { cause });
    this.name = "OutboxPersistenceError";
    this.operation = operation;
    this.requestId = item.requestId;
    this.conversationId = item.conversationId;
  }
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
  let disposed = false;
  const unpersisted = new Set<string>();
  // Ephemeral evidence belongs only to this host/device outbox. A canonical row
  // may arrive before its accepted receipt; retain its exact identity until both
  // are present, without treating transcript visibility as delivery acceptance.
  const canonical = new Map<string, string>();
  const identity = (item: OutboxItem) => JSON.stringify([item.conversationId, item.sessionId, item.deviceId, item.requestId]);
  let loaded: Promise<void> | undefined;
  let timer: unknown;
  let version = 0;
  const running = new Set<string>();
  const listeners = new Set<() => void>();
  let writes: Promise<void> = Promise.resolve();

  const emit = () => { version++; for (const listener of [...listeners]) listener(); };
  const persist = (required = false, excluding?: string, committed?: () => void) => {
    const saved = writes.then(async () => {
      // Capture at execution, not when queued: a later save must never revive
      // an intent removed by an earlier verified discard/rollback.
      const snapshot = items.filter(item => item.requestId !== excluding).map(item => ({ ...item }));
      await options.store.save(snapshot);
      committed?.();
    });
    writes = saved.catch(() => {});
    return required ? saved : writes;
  };
  const patch = (requestId: string, change: Partial<OutboxItem>, required = false) => {
    items = items.map(item => item.requestId === requestId ? { ...item, ...change } : item);
    emit();
    return persist(required);
  };
  const find = (requestId: string) => items.find(item => item.requestId === requestId);
  async function settleAccepted() {
    if (disposed) return;
    const next = items.filter(item => !(item.state === "sent" && item.persistence !== "unconfirmed"
      && !unpersisted.has(item.requestId) && canonical.get(item.requestId) === identity(item)));
    for (const requestId of canonical.keys()) if (!next.some(item => item.requestId === requestId)) canonical.delete(requestId);
    if (next.length === items.length) return;
    items = next;
    emit();
    await persist();
  }
  function load() {
    loaded ??= options.store.load().then(saved => {
      // Whatever was in flight when the app died is uncertain, not failed: reconcile by receipt.
      items = saved.map(item => item.persistence === "unconfirmed" ? { ...item, state: "unconfirmed" as const } : item.state === "sending" ? { ...item, state: "queued" as const, retryAt: undefined } : item);
      emit();
    }).catch(error => { loaded = undefined; throw error; });
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
    if (!transport || disposed) return false;
    await patch(item.requestId, { state: "sending", error: undefined });
    try {
      const deviceId = await transport.deviceId();
      if (disposed) return false;
      if (!deviceId) throw Object.assign(new Error("This device is not paired. Reconnect in Settings."), { status: 401 });
      if (item.deviceId && item.deviceId !== deviceId)
        throw Object.assign(new Error("This send belongs to a previous device pairing. Review it on your host."), { status: 409 });
      const sessionId = item.sessionId ?? (await transport.target(item.conversationId)).sessionId;
      if (disposed) return false;
      const submission = { conversationId: item.conversationId, sessionId, requestId: item.requestId, text: item.text, attachments: item.attachments };
      await patch(item.requestId, { deviceId, sessionId }, true);
      if (disposed) return false;
      let receipt: SubmissionReceipt;
      try { receipt = await transport.submission(item.requestId); }
      catch (error) { if (status(error) !== 404) throw error; if (disposed) return false; receipt = await transport.submit(submission); }
      if (disposed) return false;
      if (receipt.requestId !== item.requestId || (receipt.conversationId !== undefined && receipt.conversationId !== item.conversationId) || (receipt.sessionId !== undefined && receipt.sessionId !== sessionId)) {
        await patch(item.requestId, { state: "unconfirmed", error: "The host receipt did not match this message. Review it on the computer." }); return;
      }
      if (receipt.status === "rejected") { await patch(item.requestId, { state: "rejected", error: "The host rejected this message." }); return; }
      if (receipt.status !== "accepted") { await patch(item.requestId, { state: "unconfirmed", error: "The host has not confirmed this message yet." }); return; }
      void transport.remember?.(submission, receipt)?.catch(() => {});
      await patch(item.requestId, { state: "sent", error: undefined, retryAt: undefined });
      await settleAccepted();
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
    if (disposed || running.has(conversationId)) return;
    running.add(conversationId);
    try {
      for (;;) {
        if (disposed) return;
        // FIFO: an item that is waiting, unconfirmed or rejected blocks the ones behind it,
        // so messages are never delivered out of order.
        const head = items.find(item => item.conversationId === conversationId && item.state !== "sent");
        if (!head || unpersisted.has(head.requestId) || head.state !== "queued" || (head.retryAt && head.retryAt > now())) return;
        if (await deliver(head) === false) return;
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
      const ambiguous = items.find(item => item.conversationId === input.conversationId && item.persistence === "unconfirmed" && !unpersisted.has(item.requestId));
      if (ambiguous) throw new OutboxPersistenceError("enqueue", ambiguous);
      // The first durable record is deliberately non-executable. If the write
      // succeeds but verification and rollback fail, restart must not send it.
      const item: OutboxItem = { requestId: options.newId(), conversationId: input.conversationId, text, attachments, createdAt: now(), state: "unconfirmed", persistence: "unconfirmed", attempts: 0 };
      if (disposed) throw new Error("This outbox belongs to a previous host connection.");
      unpersisted.add(item.requestId);
      items = [...items, item];
      emit();
      try { await persist(true); }
      catch (error) {
        try {
          await persist(true, item.requestId, () => {
            items = items.filter(other => other.requestId !== item.requestId);
            emit();
          });
        }
        catch (rollbackError) {
          item.error = "Local message storage is unconfirmed. Retry or discard this pending message.";
          emit();
          throw new OutboxPersistenceError("enqueue", item, { save: error, rollback: rollbackError });
        }
        // Only verified removal authorizes an absent-item failure.
        throw error;
      } finally { unpersisted.delete(item.requestId); }
      const queued: OutboxItem = { ...item, state: "queued", persistence: undefined };
      items = items.map(other => other.requestId === item.requestId ? queued : other);
      emit();
      // The intent is already verified durable. Failed promotion must not turn
      // that known intent into a rejected/absent enqueue; restart sees either
      // this queued record or its non-executable unconfirmed predecessor.
      await persist();
      void flush(item.conversationId).catch(() => {});
      return queued;
    },
    /** Manual retry of an unconfirmed item. A rejected item is final; discard it instead. */
    async retry(requestId: string) {
      await load();
      const item = find(requestId);
      if (!item || item.state !== "unconfirmed") return;
      if (unpersisted.has(requestId) || disposed) return;
      unpersisted.add(requestId);
      try {
        await patch(requestId, { state: "queued", persistence: undefined, attempts: 0, retryAt: undefined, error: undefined }, true);
      } catch (error) {
        await patch(requestId, { state: "unconfirmed", persistence: "unconfirmed", error: "Local message storage is unconfirmed. Retry or discard this pending message." });
        throw new OutboxPersistenceError("retry", item, error);
      } finally { unpersisted.delete(requestId); }
      void flush(item.conversationId).catch(() => {});
    },
    async discard(requestId: string) {
      await load();
      const item = find(requestId);
      if (!item || item.state === "sending" || item.state === "sent") return;
      if (unpersisted.has(requestId) || disposed) return;
      unpersisted.add(requestId);
      try {
        await persist(true, requestId, () => {
          items = items.filter(other => other.requestId !== requestId);
          emit();
        });
      } catch (error) {
        await patch(requestId, { state: "unconfirmed", persistence: "unconfirmed", error: "Local message storage is unconfirmed. Retry or discard this pending message." });
        throw new OutboxPersistenceError("discard", item, error);
      } finally { unpersisted.delete(requestId); }
      void flush(item.conversationId).catch(() => {});
    },
    /** Reconcile canonical rows and accepted receipts in either arrival order. */
    async settle(conversationId: string, transcript: Pick<Message, "requestId" | "sessionId" | "role" | "localSubmission" | "pending" | "delivery">[]) {
      await load();
      if (disposed) return;
      for (const item of items) {
        if (item.conversationId !== conversationId || !item.deviceId || !item.sessionId
          || item.persistence === "unconfirmed" || unpersisted.has(item.requestId)) continue;
        if (transcript.some(row => row.role === "user" && !row.localSubmission && !row.pending && !row.delivery
          && row.requestId === item.requestId && row.sessionId === item.sessionId))
          canonical.set(item.requestId, identity(item));
      }
      await settleAccepted();
    },
    /** Network or foreground recovery: ignore backoff and try everything that is queued. */
    async resume() {
      await load();
      items = items.map(item => item.state === "queued" ? { ...item, retryAt: undefined } : item);
      await flush();
    },
    dispose() { disposed = true; canonical.clear(); clearTimer(timer); listeners.clear(); },
  };
}
export type Outbox = ReturnType<typeof createOutbox>;
