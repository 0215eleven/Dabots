import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import * as Network from "expo-network";
import { createPeerWatcher, emptyPeer, type PeerState } from "../logic/peer-hosts";
import { hostKey } from "../logic/hosts";
import { teamState } from "../types";
import { readCache, writeCache, type Host } from "../storage";
import { useSession } from "./SessionProvider";
import { hostClients } from "./shared-host-clients";

/** Foreground reads of the other computers. The active computer keeps its own faster sync. */
const PEER_INTERVAL_MS = 15_000;

interface PeerHosts { peers: Readonly<Record<string, PeerState>> }
const Context = createContext<PeerHosts>({ peers: {} });
export const usePeerHosts = () => useContext(Context);

/** Watches every saved computer except the one the session is showing. */
export function PeerHostsProvider({ children }: { children: React.ReactNode }) {
  const { hosts, host: active, foreground } = useSession();
  const [peers, setPeers] = useState<Record<string, PeerState>>({});
  const watchers = useRef(new Map<string, { refresh(): Promise<void> }>());
  const others = useMemo(() => hosts.filter(item => !active || hostKey(item) !== hostKey(active) || item.serverId !== active.serverId), [hosts, active]);
  const othersKey = JSON.stringify(others.map(item => [item.serverId, hostKey(item)]));

  useEffect(() => {
    const stops = others.map(item => watch(item));
    setPeers(current => Object.fromEntries(others.map(item => [item.serverId, current[item.serverId] ?? emptyPeer(item.serverId)])));
    return () => { for (const stop of stops) stop(); };

    function watch(target: Host) {
      let stopped = false, release: (() => void) | null = null, dispose: (() => void) | null = null;
      const set = (state: PeerState) => { if (!stopped) setPeers(current => ({ ...current, [target.serverId]: state })); };
      void hostClients.acquire(target).then(lease => {
        if (stopped) return lease.release();
        release = lease.release;
        const watcher = createPeerWatcher({ serverId: target.serverId, client: lease.client, readCache, writeCache, onChange: set });
        dispose = () => watcher.dispose();
        watchers.current.set(target.serverId, watcher);
        void watcher.start();
      }, async error => {
        // Not openable (pairing gone or changed): the cached list still shows, as offline.
        const [team, conversations] = await Promise.all([readCache(target.serverId, "team"), readCache(target.serverId, "conversations")]).catch(() => [null, null]);
        set({ ...emptyPeer(target.serverId), online: false, error: error instanceof Error ? error.message : String(error),
          team: team && typeof team === "object" ? teamState(team as Record<string, unknown>) : null, conversations: Array.isArray(conversations) ? conversations : [] });
      });
      return () => {
        stopped = true;
        watchers.current.delete(target.serverId);
        dispose?.();
        release?.();
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [othersKey]);

  // Read the other computers while the app is in front, and right away when it comes back or the network changes.
  useEffect(() => {
    if (!foreground) return;
    const refreshAll = () => { for (const watcher of watchers.current.values()) void watcher.refresh(); };
    refreshAll();
    const timer = setInterval(refreshAll, PEER_INTERVAL_MS);
    const network = Network.addNetworkStateListener(state => { if (state.isConnected) refreshAll(); });
    return () => { clearInterval(timer); network.remove(); };
  }, [foreground, othersKey]);

  const value = useMemo(() => ({ peers }), [peers]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
