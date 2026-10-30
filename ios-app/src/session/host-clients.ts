import type { MobileClient } from "@ds-bot/mobile-sdk";
import { hostKey, type SavedHost } from "../logic/hosts.ts";

export interface HostLease {
  client: MobileClient;
  /** Idempotent. The client is disposed when its last lease is released. */
  release(): void;
}

/**
 * One MobileClient per saved computer, shared by the active session and the background
 * watchers of the other computers. Pairing refresh tokens rotate on use, so two clients
 * refreshing the same pairing at once could revoke it; sharing one client serializes them.
 */
export function createHostClients(open: (host: SavedHost) => Promise<MobileClient>) {
  interface Entry { opening: Promise<MobileClient>; client: MobileClient | null; users: number; disposed: boolean }
  const entries = new Map<string, Entry>();
  const keyOf = (host: SavedHost) => JSON.stringify([host.serverId, hostKey(host)]);

  function lease(key: string, entry: Entry, client: MobileClient): HostLease {
    let released = false;
    return {
      client,
      release() {
        if (released) return;
        released = true;
        entry.users--;
        if (entry.users > 0) return;
        entry.disposed = true;
        if (entries.get(key) === entry) entries.delete(key);
        client.dispose();
      },
    };
  }

  async function acquire(host: SavedHost): Promise<HostLease> {
    const key = keyOf(host);
    let entry = entries.get(key);
    if (!entry) {
      const created: Entry = { opening: open(host), client: null, users: 0, disposed: false };
      entries.set(key, created);
      created.opening.then(client => { created.client = client; }, () => { if (entries.get(key) === created) entries.delete(key); });
      entry = created;
    }
    entry.users++;
    let client: MobileClient;
    try { client = await entry.opening; }
    catch (error) { entry.users--; throw error; }
    // A new pairing replaced this client while this caller waited for the open.
    if (entry.disposed) { entry.users--; return acquire(host); }
    return lease(key, entry, client);
  }

  /** A client created elsewhere (a new pairing) becomes the shared client of its computer. */
  function adopt(host: SavedHost, client: MobileClient): HostLease {
    const key = keyOf(host);
    const previous = entries.get(key);
    if (previous?.client && previous.client !== client && previous.users > 0) {
      // The pairing replaced the credentials of a computer that was already open; its old client is stale.
      previous.disposed = true;
      previous.client.dispose();
    }
    const entry: Entry = { opening: Promise.resolve(client), client, users: 1, disposed: false };
    entries.set(key, entry);
    return lease(key, entry, client);
  }

  /** The current shared client of a computer, without taking a lease. */
  function peek(host: SavedHost): MobileClient | null {
    return entries.get(keyOf(host))?.client ?? null;
  }

  return { acquire, adopt, peek };
}
