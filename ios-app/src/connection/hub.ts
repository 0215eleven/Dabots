/**
 * Decides *when* to reconnect. The stream itself (sequence numbers, acknowledgements, cursor
 * catch-up, backoff capped at 15 s) lives in the SDK; the hub only turns system signals into
 * "reconnect now": the network coming back, the app returning to the foreground, a push arriving.
 */
export type ResumeReason = "network" | "foreground" | "push" | "manual";
export interface NetworkState { type?: string | null; isConnected?: boolean | null; isInternetReachable?: boolean | null }

/** Reports a transition from offline to online, or a change of interface while online (Wi-Fi to cellular). */
export function createRecoveryDetector(onRecover: () => void) {
  let last: { online: boolean; type?: string | null } | undefined;
  return (state: NetworkState) => {
    const online = state.isConnected !== false && state.isInternetReachable !== false;
    const switched = !!last && online && last.online && !!state.type && !!last.type && state.type !== last.type;
    if (last && online && (!last.online || switched)) onRecover();
    last = { online, type: state.type };
  };
}

export interface HubDeps {
  appState: { currentState: string | null | undefined; addEventListener(event: "change", listener: (state: string) => void): { remove(): void } };
  network: { addListener(listener: (state: NetworkState) => void): { remove(): void } };
  /** Reconnect every open stream now, resuming from its cursor. */
  reconnectStreams(): void;
  /** Retry queued outgoing messages without waiting for their backoff. */
  resumeOutbox(): void | Promise<void>;
  /** Refresh the conversation list, team state and capabilities. */
  refreshWorkspace?(): void | Promise<void>;
  /** Called when a push notification arrives or is opened. */
  pushes?: { addListener(listener: (data: Record<string, unknown>) => void): { remove(): void } };
  onResume?(reason: ResumeReason): void;
}

export function createConnectionHub(deps: HubDeps) {
  let stops: Array<{ remove(): void }> = [];
  let last = 0;
  function resume(reason: ResumeReason) {
    // A network flap often delivers several callbacks at once; one pass is enough.
    const stamp = Date.now();
    if (reason !== "manual" && stamp - last < 250) return;
    last = stamp;
    deps.onResume?.(reason);
    deps.reconnectStreams();
    void Promise.resolve(deps.resumeOutbox()).catch(() => {});
    void Promise.resolve(deps.refreshWorkspace?.()).catch(() => {});
  }
  return {
    resume,
    start() {
      if (stops.length) return () => this.stop();
      let wasActive = deps.appState.currentState === "active";
      stops = [
        deps.appState.addEventListener("change", state => {
          const active = state === "active";
          if (active && !wasActive) resume("foreground");
          wasActive = active;
        }),
        deps.network.addListener(createRecoveryDetector(() => { if (wasActive) resume("network"); })),
        ...(deps.pushes ? [deps.pushes.addListener(() => { if (wasActive) resume("push"); })] : []),
      ];
      return () => this.stop();
    },
    stop() { for (const stop of stops) stop.remove(); stops = []; },
  };
}
export type ConnectionHub = ReturnType<typeof createConnectionHub>;
