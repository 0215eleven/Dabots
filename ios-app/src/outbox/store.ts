import type { OutboxItem, OutboxStore } from './outbox.ts';

export interface OutboxCache {
  read<T>(scope: string, key: string, options?: { strict?: boolean }): Promise<T | null>;
  write(scope: string, key: string, value: unknown): Promise<void>;
}

/** Same persisted identity as SessionProvider's original store, with verified durability. */
export function createDurableOutboxStore(serverId: string, cache: OutboxCache): OutboxStore {
  return {
    load: async () => (await cache.read<OutboxItem[]>(serverId, 'outbox', { strict: true })) ?? [],
    async save(items) {
      await cache.write(serverId, 'outbox', items);
      // Browser previews can suppress storage failures. Never claim that an
      // enqueue is durable when the underlying store silently discarded it.
      const saved = await cache.read<OutboxItem[]>(serverId, 'outbox', { strict: true });
      if (JSON.stringify(saved) !== JSON.stringify(items)) {
        throw new Error('The outgoing message could not be saved. Keep your draft and retry.');
      }
    },
  };
}
