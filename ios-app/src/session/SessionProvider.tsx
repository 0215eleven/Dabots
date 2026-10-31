import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useRouter } from "expo-router";
import type { Conversation, MobileClient } from "@ds-bot/mobile-sdk";
import { useWorkspace } from "../hooks/useWorkspace";
import { useNotifications } from "../hooks/useNotifications";
import { createConnectionHub } from "../connection/hub";
import { createOutbox, type Outbox } from "../outbox/outbox";
import { conversationStreams, watchConversationStreamLifecycle } from "../logic/conversation-streams";
import { activeHost, hostKey, removeHost, restoreHosts, upsertHost } from "../logic/hosts";
import { endBotActivity, syncBotActivity } from "../liveactivity/controller";
import { notificationArrivals, notificationResponses } from "../media/notifications";
import { stopBackgroundNotifications } from "../media/background-notifications";
import { mobileActionAllowed } from "../logic/mobile-access";
import { clearCache, Host, readCache, tokenStoreFor, writeCache } from "../storage";
import { setColorMode, setThemePreferences, type ColorMode } from "../theme";
import { LocalePreference, setHostLocale, setLocalePreference } from "../i18n";
import { errorText } from "../types";
import { createDurableOutboxStore } from "../outbox/store";
import { hostClients } from "./shared-host-clients";
import type { HostLease } from "./host-clients";
import { createHostTransitions } from "./host-transitions";
import { enabledFixture, fixtureControl } from "../preview/enabled-fixture";
import { designPreview, previewClient, previewHosts } from "../preview/preview-session";

type Workspace = ReturnType<typeof useWorkspace>;
export interface Session {
  loading: boolean;
  error: string;
  hosts: Host[];
  host: Host | null;
  client: MobileClient | null;
  /** A computer selection, pairing or removal is still committing on this phone. */
  switching: boolean;
  workspace: Workspace;
  outbox: Outbox | null;
  foreground: boolean;
  /** Classic Agent mode: the home list shows only DSH Agent conversations. Off when the computer offers none. */
  agentMode: boolean;
  /** This computer offers DSH Agents to this phone. */
  agentsAvailable: boolean;
  setAgentMode(value: boolean): Promise<void>;
  /** Slot for the next pairing; changes after each successful pairing. */
  pairingSlot: string;
  connected(host: Host, client: MobileClient): Promise<void>;
  switchHost(host: Host): Promise<boolean>;
  forgetHost(host: Host): Promise<void>;
  disconnect(): Promise<void>;
  /** Catch every stream and queued send up now (network back, foreground, push, pull to refresh). */
  resume(): void;
  open(conversation: Conversation | string): void;
}
const SessionContext = createContext<Session | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Session is unavailable outside its provider.");
  return value;
}

const newSlot = () => Crypto.randomUUID();
const ownerStore = (serverId: string) => createDurableOutboxStore(serverId, { read: readCache, write: writeCache });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [host, setHost] = useState<Host | null>(null);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [switching, setSwitching] = useState(false);
  const transitions = useRef<ReturnType<typeof createHostTransitions> | null>(null);
  transitions.current ??= createHostTransitions(setSwitching);
  const selection = transitions.current;
  const hostsRef = useRef(hosts); hostsRef.current = hosts;
  const hostRef = useRef(host); hostRef.current = host;
  const clientRef = useRef(client); clientRef.current = client;
  const [loading, setLoading] = useState(true);
  const restoring = useRef(true);
  const [error, setError] = useState("");
  const [pairingSlot, setPairingSlot] = useState(newSlot);
  const [foreground, setForeground] = useState(AppState.currentState === "active");
  const workspace = useWorkspace(client, host);
  const [agentChoice, setAgentChoice] = useState(false);
  // As in the classic shell: the host must offer the Agent and the owner must have allowed this phone,
  // or an Agent conversation is already listed; otherwise the mode would leave an empty list.
  const agentsAvailable = (mobileActionAllowed(workspace.team.mobileCapabilities, "agent-open") && workspace.team.agentAccess === true)
    || workspace.conversations.some(item => item.kind === "agent");
  const agentMode = agentChoice && agentsAvailable;
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  // Leases on the shared per-computer clients this session has shown; released when it stops showing one.
  const leases = useRef(new Map<MobileClient, HostLease[]>());
  const managedClients = useRef(new WeakSet<MobileClient>());
  const hold = (lease: HostLease) => {
    managedClients.current.add(lease.client);
    leases.current.set(lease.client, [...(leases.current.get(lease.client) ?? []), lease]);
    return lease.client;
  };
  const letGo = (value: MobileClient) => {
    const held = leases.current.get(value);
    const lease = held?.shift();
    if (held && !held.length) leases.current.delete(value);
    if (lease) lease.release();
    else if (!managedClients.current.has(value)) value.dispose();
  };
  const showHost = (value: Host | null, connection: MobileClient | null) => {
    hostRef.current = value;
    clientRef.current = connection;
    setHost(value);
    setClient(connection);
  };
  const rememberHosts = (value: Host[]) => { hostsRef.current = value; setHosts(value); };
  useEffect(() => { selection.setActive(true); return () => selection.setActive(false); }, [selection]);

  useEffect(() => {
    void readCache<ColorMode>("app", "colorMode").then(value => { if (value === "dark" || value === "light") setColorMode(value); }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabledFixture || !fixtureControl) return;
    fixtureControl.refresh = () => workspaceRef.current.refreshSnapshot({fresh:true});
    fixtureControl.replaceHost = () => { if(client) conversationStreams.clear(client); showHost(previewHosts[1], previewClient('studio')); };
  }, [client]);

  // Restore saved computers and open the active one.
  useEffect(() => {
    if (designPreview) {
      let mounted = true;
      rememberHosts(previewHosts);
      void hostClients.acquire(previewHosts[0]).then(lease => {
        if (!mounted) return lease.release();
        showHost(previewHosts[0], hold(lease));
      }).catch(err => { if (mounted) setError(errorText(err)); })
        .finally(() => { if (mounted) { restoring.current = false; setLoading(false); } });
      return () => { mounted = false; };
    }
    let mounted = true;
    void Promise.all([readCache<Host[]>("app", "hosts"), readCache<Host>("app", "host"), readCache<string>("app", "activeHost")])
      .then(async ([saved, legacy, active]) => {
        const list = restoreHosts(saved, legacy);
        if (legacy) { await writeCache("app", "hosts", list); await writeCache("app", "host", null); }
        if (!mounted) return;
        rememberHosts(list);
        const target = activeHost(list, active);
        if (!target) return;
        const stored = await tokenStoreFor(target.slot).get();
        if (!mounted) return;
        if (!stored && list.length === 1) return;
        const lease = await hostClients.acquire(target);
        if (!mounted) return lease.release();
        showHost(target, hold(lease));
      })
      .catch(err => { if (mounted) setError(errorText(err)); })
      .finally(() => { if (mounted) { restoring.current = false; setLoading(false); } });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const stop = watchConversationStreamLifecycle(client, AppState, setForeground);
    return () => { stop(); if (client) letGo(client); };
  }, [client]);
  // A committed client can be held before React renders its [client] effect.
  // Release those remaining leases too; never directly dispose a shared client
  // whose other leases belong to the background watchers.
  useEffect(() => () => {
    for (const held of leases.current.values()) for (const lease of held) lease.release();
    leases.current.clear();
  }, []);

  useEffect(() => { setThemePreferences(workspace.team.prefs); }, [workspace.team.prefs]);

  // Language preference per computer, then the host's own language setting.
  const canReadSettings = mobileActionAllowed(workspace.team.mobileCapabilities, "settings-describe");
  useEffect(() => {
    let alive = true;
    setHostLocale(undefined);
    setLocalePreference("host");
    if (!client || !host) return;
    setAgentChoice(false);
    // The same per-computer preference the classic shell keeps.
    void readCache<{ locale?: LocalePreference; classic?: boolean }>(host.serverId, "mobile-preferences").then(value => {
      if (!alive || !value) return;
      if (value.locale) setLocalePreference(value.locale);
      setAgentChoice(!!value.classic);
    }).catch(() => {});
    if (canReadSettings) void client.settings().then(description => {
      const value = description.namespaces.find(item => item.ns === "locale")?.value;
      if (alive && value && typeof value === "object" && !Array.isArray(value)) setHostLocale(value.preference as string | undefined);
    }).catch(() => {});
    return () => { alive = false; };
  }, [client, host, canReadSettings]);

  // Durable outbox for this computer.
  const outbox = useMemo(() => {
    if (!client || !host) return null;
    return createOutbox({
      store: ownerStore(host.serverId),
      newId: () => Crypto.randomUUID(),
      transport: () => ({
        deviceId: async () => (await tokenStoreFor(host.slot).get())?.deviceId,
        target: id => client.target(id),
        submission: id => client.submission(id),
        submit: payload => client.submit(payload),
        remember: (payload, receipt) => client.rememberAcceptedSubmission(payload, receipt),
      }),
    });
  }, [client, host]);
  useEffect(() => { void outbox?.load().then(() => outbox.resume()).catch(() => {}); return () => outbox?.dispose(); }, [outbox]);

  const resume = useCallback(() => {
    if (client) conversationStreams.reconnectAll(client);
    void outbox?.resume().catch(err => setError(errorText(err)));
    void workspaceRef.current.refresh();
  }, [client, outbox]);

  // Network recovery, foreground and push all mean the same thing: catch up from the cursor now.
  useEffect(() => {
    if (!client) return;
    const hub = createConnectionHub({
      appState: AppState,
      network: { addListener: listener => Network.addNetworkStateListener(listener) },
      reconnectStreams: () => conversationStreams.reconnectAll(client),
      resumeOutbox: () => outbox?.resume(),
      refreshWorkspace: () => workspaceRef.current.refresh(),
      pushes: { addListener: listener => ({ remove: notificationArrivals(listener) }) },
    });
    hub.start();
    return () => hub.stop();
  }, [client, outbox]);

  // Dynamic Island: mirror what the Bots are doing while the app is running.
  useEffect(() => {
    if (!host || !client) { void endBotActivity(); return; }
    void syncBotActivity(workspace.team, host.name, !workspace.online);
  }, [client, host, workspace.team, workspace.online]);

  const open = useCallback((target: Conversation | string) => {
    const id = typeof target === "string"
      ? workspaceRef.current.conversations.find(item => item.id === target || item.id === `bot:${target}` || item.id === `room:${target}`)?.id || target
      : target.id;
    router.push({ pathname: "/chat/[agentId]", params: { agentId: id } });
  }, [router]);
  const openRef = useRef(open);
  openRef.current = open;
  const notificationTarget = useRef<object | null>(null);
  useNotifications(client, host?.serverId, workspace.online, id => openRef.current(id), undefined, workspace.team.mobileCapabilities);

  // A tap on a notification of another saved computer: switch to it, then open the chat.
  useEffect(() => notificationResponses(data => {
    if (typeof data.serverId !== "string" || typeof data.conversationId !== "string") return;
    if (data.serverId === hostRef.current?.serverId) return;
    const target = hostsRef.current.find(item => item.serverId === data.serverId);
    if (!target) return;
    const conversation = data.conversationId, intent = {};
    notificationTarget.current = intent;
    void switchHost(target).then(ok => {
      if (notificationTarget.current !== intent) return;
      if (ok && hostRef.current?.serverId === target.serverId) openRef.current(conversation);
      notificationTarget.current = null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  function resetHostView() {
    setThemePreferences({});
    void endBotActivity();
    if (router.canDismiss()) router.dismissAll();
  }
  async function setAgentMode(value: boolean) {
    setAgentChoice(value);
    if (!host) return;
    const previous = (await readCache<Record<string, unknown>>(host.serverId, "mobile-preferences")) || {};
    await writeCache(host.serverId, "mobile-preferences", { ...previous, classic: value });
  }
  function mutateHost(run: (current: () => boolean) => Promise<void>) {
    if (restoring.current) return Promise.reject(new Error('A computer change is already in progress. Try again.'));
    return selection.mutate(run);
  }
  async function connected(value: Host, connection: MobileClient) {
    return mutateHost(async current => {
      const assertCurrent = () => { if (!current()) throw new Error('The computer change was cancelled. Try again.'); };
      assertCurrent();
      const { hosts: next, replaced } = upsertHost(hostsRef.current, value);
      await Promise.allSettled(replaced.map(item => tokenStoreFor(item.slot).clear()));
      assertCurrent();
      await writeCache("app", "hosts", next);
      assertCurrent();
      await writeCache("app", "activeHost", hostKey(value));
      assertCurrent();
      if (clientRef.current) conversationStreams.clear(clientRef.current);
      rememberHosts(next);
      showHost(value, hold(hostClients.adopt(value, connection)));
      setError("");
      setPairingSlot(newSlot());
      resetHostView();
    });
  }
  const sameHost = (left: Host | null, right: Host) => left?.serverId === right.serverId && hostKey(left) === hostKey(right);
  async function selectHost(target: Host, current: () => boolean) {
    if (!current() || !hostsRef.current.some(item => sameHost(item, target))) return false;
    if (clientRef.current && sameHost(hostRef.current, target)) return true;
    setError("");
    let lease: HostLease | null = null;
    try {
      lease = await hostClients.acquire(target);
      if (!current()) return false;
      await writeCache("app", "activeHost", hostKey(target));
      if (!current()) return false;
      if (clientRef.current) conversationStreams.clear(clientRef.current);
      showHost(target, hold(lease));
      lease = null;
      resetHostView();
      return true;
    } catch (err) {
      if (current()) setError(errorText(err));
      return false;
    } finally { lease?.release(); }
  }
  function switchHost(target: Host) {
    if (restoring.current) return Promise.resolve(false);
    return selection.switchTo(JSON.stringify([target.serverId, hostKey(target)]), current => selectHost(target, current));
  }
  async function forgetHost(target: Host) {
    return mutateHost(async current => {
      if (!current()) return;
      if (clientRef.current && sameHost(hostRef.current, target)) return;
      const rest = removeHost(hostsRef.current, target);
      await tokenStoreFor(target.slot).clear();
      if (!current()) return;
      await clearCache(target.serverId);
      if (!current()) return;
      await writeCache("app", "hosts", rest);
      if (current()) rememberHosts(rest);
    });
  }
  async function disconnect() {
    return mutateHost(async current => {
      if (!current()) return;
      const client = clientRef.current, host = hostRef.current;
      if (client) conversationStreams.clear(client);
      if (host) {
        await writeCache(host.serverId, "backgroundOptIn", false);
        if (!current()) return;
        await writeCache(host.serverId, "pushOptIn", false);
        if (!current()) return;
      }
      const allows = (action: string) => mobileActionAllowed(workspace.team.mobileCapabilities, action);
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
      try {
        await Promise.allSettled([
          stopBackgroundNotifications(allows("notifications-background-unregister") ? client || undefined : undefined),
          allows("notifications-preferences") ? client?.action("notifications-preferences", { enabled: false, categories: [] }, { signal: controller.signal }) : undefined,
        ]);
      } finally { clearTimeout(timer); }
      if (!current()) return;
      if (client) await client.logout(); else if (host) await tokenStoreFor(host.slot).clear();
      if (!current()) return;
      const rest = host ? removeHost(hostsRef.current, host) : hostsRef.current;
      await writeCache("app", "hosts", rest);
      if (!current()) return;
      await writeCache("app", "activeHost", null);
      if (!current()) return;
      rememberHosts(rest);
      showHost(null, null);
      resetHostView();
      if (rest[0]) await selectHost(rest[0], current);
    });
  }

  const value: Session = {
    loading, error, hosts, host, client, switching, workspace, outbox, foreground, pairingSlot, agentMode, agentsAvailable, setAgentMode,
    connected, switchHost, forgetHost, disconnect, resume, open,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
