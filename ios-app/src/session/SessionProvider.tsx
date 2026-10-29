import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import * as Network from "expo-network";
import { useRouter } from "expo-router";
import type { Conversation, MobileClient } from "@ds-bot/mobile-sdk";
import { useWorkspace } from "../hooks/useWorkspace";
import { useNotifications } from "../hooks/useNotifications";
import { createConnectionHub } from "../connection/hub";
import { createOutbox, type Outbox, type OutboxItem } from "../outbox/outbox";
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
import { openHost } from "./open-host";
import { designPreview, previewClient, previewHosts } from "../preview/preview-session";

type Workspace = ReturnType<typeof useWorkspace>;
export interface Session {
  loading: boolean;
  error: string;
  hosts: Host[];
  host: Host | null;
  client: MobileClient | null;
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
const ownerStore = (serverId: string) => ({
  load: async () => (await readCache<OutboxItem[]>(serverId, "outbox")) ?? [],
  save: (items: OutboxItem[]) => writeCache(serverId, "outbox", items),
});

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [hosts, setHosts] = useState<Host[]>([]);
  const [host, setHost] = useState<Host | null>(null);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [loading, setLoading] = useState(true);
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

  useEffect(() => {
    void readCache<ColorMode>("app", "colorMode").then(value => { if (value === "dark" || value === "light") setColorMode(value); }).catch(() => {});
  }, []);

  // Restore saved computers and open the active one.
  useEffect(() => {
    if (designPreview) {
      setHosts(previewHosts);
      setHost(previewHosts[0]);
      setClient(previewClient());
      setLoading(false);
      return;
    }
    let mounted = true;
    void Promise.all([readCache<Host[]>("app", "hosts"), readCache<Host>("app", "host"), readCache<string>("app", "activeHost")])
      .then(async ([saved, legacy, active]) => {
        const list = restoreHosts(saved, legacy);
        if (legacy) { await writeCache("app", "hosts", list); await writeCache("app", "host", null); }
        if (!mounted) return;
        setHosts(list);
        const target = activeHost(list, active);
        if (!target) return;
        const stored = await tokenStoreFor(target.slot).get();
        if (!stored && list.length === 1) return;
        const connection = await openHost(target);
        if (!mounted) return connection.dispose();
        setHost(target);
        setClient(connection);
      })
      .catch(err => setError(errorText(err)))
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const stop = watchConversationStreamLifecycle(client, AppState, setForeground);
    return () => { stop(); client?.dispose(); };
  }, [client]);

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
    void outbox?.resume();
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
    router.push({ pathname: "/chat/[id]", params: { id } });
  }, [router]);
  const openRef = useRef(open);
  openRef.current = open;
  const notificationTarget = useRef<string | null>(null);
  useNotifications(client, host?.serverId, workspace.online, id => openRef.current(id), undefined, workspace.team.mobileCapabilities);

  // A tap on a notification of another saved computer: switch to it, then open the chat.
  const hostsRef = useRef(hosts); hostsRef.current = hosts;
  const hostRef = useRef(host); hostRef.current = host;
  useEffect(() => notificationResponses(data => {
    if (typeof data.serverId !== "string" || typeof data.conversationId !== "string") return;
    if (data.serverId === hostRef.current?.serverId) return;
    const target = hostsRef.current.find(item => item.serverId === data.serverId);
    if (!target) return;
    notificationTarget.current = data.conversationId;
    void switchHost(target).then(ok => { if (ok && notificationTarget.current) openRef.current(notificationTarget.current); notificationTarget.current = null; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  function resetHostView() {
    setThemePreferences({});
    void endBotActivity();
    router.dismissAll?.();
  }
  async function setAgentMode(value: boolean) {
    setAgentChoice(value);
    if (!host) return;
    const previous = (await readCache<Record<string, unknown>>(host.serverId, "mobile-preferences")) || {};
    await writeCache(host.serverId, "mobile-preferences", { ...previous, classic: value });
  }
  async function connected(value: Host, connection: MobileClient) {
    const { hosts: next, replaced } = upsertHost(hosts, value);
    await Promise.allSettled(replaced.map(item => tokenStoreFor(item.slot).clear()));
    await writeCache("app", "hosts", next);
    await writeCache("app", "activeHost", hostKey(value));
    if (client) conversationStreams.clear(client);
    setHosts(next);
    setHost(value);
    setClient(connection);
    setError("");
    setPairingSlot(newSlot());
    resetHostView();
  }
  async function switchHost(target: Host) {
    if (client && host && hostKey(host) === hostKey(target)) return true;
    setError("");
    try {
      const connection = await openHost(target);
      await writeCache("app", "activeHost", hostKey(target));
      if (client) conversationStreams.clear(client);
      setHost(target);
      setClient(connection);
      resetHostView();
      return true;
    } catch (err) {
      setError(errorText(err));
      return false;
    }
  }
  async function forgetHost(target: Host) {
    if (client && host && hostKey(host) === hostKey(target)) return;
    const rest = removeHost(hosts, target);
    await tokenStoreFor(target.slot).clear();
    await clearCache(target.serverId);
    await writeCache("app", "hosts", rest);
    setHosts(rest);
  }
  async function disconnect() {
    if (client) conversationStreams.clear(client);
    if (host) { await writeCache(host.serverId, "backgroundOptIn", false); await writeCache(host.serverId, "pushOptIn", false); }
    const allows = (action: string) => mobileActionAllowed(workspace.team.mobileCapabilities, action);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
    try {
      await Promise.allSettled([
        stopBackgroundNotifications(allows("notifications-background-unregister") ? client || undefined : undefined),
        allows("notifications-preferences") ? client?.action("notifications-preferences", { enabled: false, categories: [] }, { signal: controller.signal }) : undefined,
      ]);
    } finally { clearTimeout(timer); }
    if (client) await client.logout(); else if (host) await tokenStoreFor(host.slot).clear();
    const rest = host ? removeHost(hosts, host) : hosts;
    await writeCache("app", "hosts", rest);
    await writeCache("app", "activeHost", null);
    setHosts(rest);
    setClient(null);
    setHost(null);
    resetHostView();
    if (rest[0]) await switchHost(rest[0]);
  }

  const value: Session = {
    loading, error, hosts, host, client, workspace, outbox, foreground, pairingSlot, agentMode, agentsAvailable, setAgentMode,
    connected, switchHost, forgetHost, disconnect, resume, open,
  };
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
