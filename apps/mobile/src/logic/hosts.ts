// Saved computers. Each one keeps its own credential slot and cache scope (its serverId).
export interface SavedHost {
  url: string;
  serverId: string;
  name: string;
  allowInsecure?: boolean;
  tlsPin?: string;
  slot?: string;
  /** Reached through the owner's relay instead of a direct address. */
  relay?: { relay: string; computerId: string; computerKey: string };
}

export const hostKey = (host: SavedHost) => host.slot || "";

/** Reads the saved list, adopting the single host stored before multi-host support. */
export function restoreHosts<T extends SavedHost>(saved: unknown, legacy: T | null): T[] {
  const list = Array.isArray(saved)
    ? saved.filter((item): item is T => !!item && typeof item === "object" && typeof item.serverId === "string" && typeof item.url === "string")
    : [];
  if (legacy && !list.some(item => item.serverId === legacy.serverId)) list.unshift(legacy);
  const seen = new Set<string>();
  return list.filter(item => {
    const key = hostKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Adds or re-pairs a computer. A computer appears once; re-pairing replaces its slot. */
export function upsertHost<T extends SavedHost>(list: T[], host: T): { hosts: T[]; replaced: T[] } {
  const replaced = list.filter(item => item.serverId === host.serverId || hostKey(item) === hostKey(host));
  const index = list.findIndex(item => replaced.includes(item));
  const rest = list.filter(item => !replaced.includes(item));
  const hosts = index < 0 ? [...rest, host] : [...rest.slice(0, index), host, ...rest.slice(index)];
  return { hosts, replaced: replaced.filter(item => hostKey(item) !== hostKey(host)) };
}

export function removeHost<T extends SavedHost>(list: T[], host: SavedHost) {
  return list.filter(item => hostKey(item) !== hostKey(host));
}

/** The computer to open: the last active one, else the first saved one. */
export function activeHost<T extends SavedHost>(list: T[], active: unknown): T | null {
  return list.find(item => hostKey(item) === active) || list[0] || null;
}

/** Shown under each computer in the switcher, e.g. "192.168.1.8:7443". */
export function hostAddress(host: Pick<SavedHost, "url" | "relay">) {
  if (host.relay) {
    try { return new URL(host.relay.relay).host; } catch { return host.relay.relay; }
  }
  try {
    const url = new URL(host.url);
    return url.host + (url.pathname !== "/" ? url.pathname.replace(/\/$/, "") : "");
  } catch {
    return host.url;
  }
}
