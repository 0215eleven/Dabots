import { createMobileClient } from "./network/client";
import { useNotifications } from "./hooks/useNotifications";
import { stopBackgroundNotifications } from './media/background-notifications';
import { notificationResponses } from './media/notifications';
import { tr } from "./i18n";
import React, { useEffect, useRef, useState } from "react";
import * as Crypto from "expo-crypto";
import {
  Platform,
  AppState,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { AnimatedPressable as Pressable } from "./components/Motion";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { Conversation, Message, MobileClient } from "@ds-bot/mobile-sdk";
import {
  Busy,
  Button,
  Icon,
  IconButton,
  Label,
  Notice,
  PageHeader,
  SettingRow,
  Sheet,
  Tag,
  DOCK_HEIGHT,
  ListRow,
  dockBottom,
} from "./components/UI";
import { BotAvatar, mainLook, RoomAvatar } from "./components/BotAvatar";
import { LaunchIntro } from "./components/LaunchIntro";
import { MotionProvider } from "./components/Motion";
import { AgentDetails } from "./components/AgentDetails";
import { useWorkspace } from "./hooks/useWorkspace";
import { ChatScreen } from "./screens/ChatScreen";
import { PairingScreen } from "./screens/PairingScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { CreationScreen } from "./screens/CreationScreen";
import { TeamScreen } from "./screens/TeamScreen";
import {
  cache,
  clearCache,
  Host,
  readCache,
  tokenStoreFor,
  writeCache,
} from "./storage";
import { activeHost, hostKey, removeHost, restoreHosts, upsertHost } from "./logic/hosts";
import { ColorMode, setColorMode, setThemePreferences, useTheme } from "./theme";
import { errorText } from "./types";
import {
  LocalePreference,
  setHostLocale,
  setLocalePreference,
  useI18n,
} from "./i18n";
import { conversationTime, orderConversations } from "./logic/conversation-order";
import { groupWorkMembers, ownBotWork, workDescription } from "./logic/group-work";
import { mobileActionAllowed, BRIDGE_UNAVAILABLE } from "./logic/mobile-access";
import { createHomeScrollRestoration } from "./logic/home-scroll";
import { ScreenActivity } from "./components/ScreenActivity";
import { NativeNavigation, createAppNavigator } from "./components/NativeNavigation";
import { HomeDock } from "./components/HomeDock";
import { AmbientGlow, EdgeFade } from "./components/Glass";
import { HostPill, HostSheet } from "./components/HostSwitcher";
import { selectConversation, type Route } from "./logic/app-navigation";
import { conversationStreams, watchConversationStreamLifecycle } from "./logic/conversation-streams";
const newSlot = () => Crypto.randomUUID();
async function openHost(saved: Host) {
  const session = await tokenStoreFor(saved.slot).get();
  if (!session || session.serverId !== saved.serverId) throw new Error("This computer is no longer paired. Pair it again.");
  if (saved.tlsPin !== session.tlsPin) throw new Error("The computer identity has changed. Pair this device again.");
  return createMobileClient({
    baseUrl: saved.url,
    tlsPin: session.tlsPin,
    ...(saved.relay ? { relay: { ...saved.relay, serverId: saved.serverId } } : {}),
    tokenStore: tokenStoreFor(saved.slot),
    cache,
    allowInsecure: __DEV__ && saved.allowInsecure,
  });
}
function Shell() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { tr, locale } = useI18n();
  const [classicChoice, setClassic] = useState(false);
  const [host, setHost] = useState<Host | null>(null);
  const [hosts, setHosts] = useState<Host[]>([]);
  const [switcher, setSwitcher] = useState(false);
  const [adding, setAdding] = useState(false);
  const [pairingSlot, setPairingSlot] = useState(newSlot);
  const [client, setClient] = useState<MobileClient | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  const [loading, setLoading] = useState(true);
  const [intro,setIntro] = useState(true);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<Route>({ page: "home" });
  const navigator = useRef(createAppNavigator()).current;
  const [selected, setSelected] = useState("");
  const [chatOpening, setChatOpening] = useState({ id: "", revision: 0 });
  const [newChat, setNewChat] = useState(false);
  const [query, setQuery] = useState("");
  const homeList = useRef<ScrollView>(null);
  const rowPositions = useRef<Record<string,{y:number;height:number}>>({});
  // Scrolling must not re-render the app; only the unread pill below depends on it.
  const homeScroll = useRef(0);
  const [, setUnreadAboveKey] = useState("");
  const [previewState, setPreviewState] = useState<{serverId:string;items:Record<string,Message>} | null>(null);
  const previews = previewState?.serverId === host?.serverId ? previewState?.items || {} : {};
  const [creating, setCreating] = useState(false);
  const workspace = useWorkspace(client, host);
  const allows = (action: string) => mobileActionAllowed(workspace.team.mobileCapabilities, action);
  // Classic mode lists only DSH Agents. When this computer's Bridge offers no
  // Agents to the phone, the choice would leave an empty, inescapable list.
  // The host must offer the Agent and the computer's owner must have allowed this phone.
  const agentAccess = allows("agent-open") && workspace.team.agentAccess === true;
  const agentsAvailable = agentAccess || workspace.conversations.some(c => c.kind === "agent");
  const classic = classicChoice && agentsAvailable;
  const canReadSettings = allows("settings-describe");
  useEffect(() => {
    void readCache<ColorMode>("app", "colorMode").then(value => {
      if (value === "dark" || value === "light") setColorMode(value);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    let mounted = true;
    void Promise.all([readCache<Host[]>("app", "hosts"), readCache<Host>("app", "host"), readCache<string>("app", "activeHost")])
      .then(async ([saved, legacy, active]) => {
        const list = restoreHosts(saved, legacy);
        if (legacy) {
          // The single pre-multi-host entry now lives in the list.
          await writeCache("app", "hosts", list);
          await writeCache("app", "host", null);
        }
        if (!mounted) return;
        setHosts(list);
        const target = activeHost(list, active);
        if (!target) return;
        const session = await tokenStoreFor(target.slot).get();
        // An unpaired single host opens pairing quietly, as before.
        if (!session && list.length === 1) return;
        const connection = await openHost(target);
        if (!mounted) return connection.dispose();
        setHost(target);
        setClient(connection);
      })
      .catch((err) => setError(errorText(err)))
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);
  useEffect(() => {
    const stop = watchConversationStreamLifecycle(client, AppState, setForeground);
    return () => {
      stop();
      client?.dispose();
    };
  }, [client]);
  useEffect(() => {
    setThemePreferences(workspace.team.prefs);
  }, [workspace.team.prefs]);
  async function readHostLanguage(connection: MobileClient) {
    const description = await connection.settings();
    const value = description.namespaces.find(
      (item) => item.ns === "locale",
    )?.value;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value.preference
      : undefined;
  }
  useEffect(() => {
    let alive = true;
    setClassic(false);
    setHostLocale(undefined);
    setLocalePreference("host");
    if (client && host) {
      void readCache<{
        classic?: boolean;
        locale?: LocalePreference;
      }>(host.serverId, "mobile-preferences")
        .then((value) => {
          if (alive && value) {
            setClassic(!!value.classic);
            setLocalePreference(value.locale || "host");
          }
        })
        .catch(() => {});
      // Language is an optional host settings endpoint.
      if (canReadSettings) void readHostLanguage(client)
        .then((value) => {
          if (alive) setHostLocale(value);
        })
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [client, host, canReadSettings]);
  async function refreshSettings() {
    await workspace.refresh();
    if (client && allows("settings-describe")) {
      try {
        setHostLocale(await readHostLanguage(client));
      } catch {}
    }
  }
  async function localPreferences(patch: {
    classic?: boolean;
    locale?: LocalePreference;
  }) {
    if (!host) return;
    const previous =
      (await readCache<{
        classic?: boolean;
        locale?: LocalePreference;
      }>(host.serverId, "mobile-preferences")) || {};
    await writeCache(host.serverId, "mobile-preferences", {
      ...previous,
      ...patch,
    });
    if (patch.classic !== undefined) {
      setClassic(patch.classic);
      setSelected("");
    }
    if (patch.locale) setLocalePreference(patch.locale);
  }
  function resetHostView() {
    // The retained home list belongs to the previous computer.
    homeScroll.current = 0;
    rowPositions.current = {};
    homeScrollRestoration.reset();
    setUnreadAboveKey("");
    homeList.current?.scrollTo({ y: 0, animated: false });
    setSelected("");
    setQuery("");
    setThemePreferences({});
    navigator.open({ page: "home" });
  }
  async function connected(value: Host, connection: MobileClient) {
    const { hosts: next, replaced } = upsertHost(hosts, value);
    // Re-pairing a computer supersedes its previous credentials on this phone.
    await Promise.allSettled(replaced.map(item => tokenStoreFor(item.slot).clear()));
    await writeCache("app", "hosts", next);
    await writeCache("app", "activeHost", hostKey(value));
    if (client) conversationStreams.clear(client);
    setHosts(next);
    setHost(value);
    setClient(connection);
    setAdding(false);
    setError("");
    setPairingSlot(newSlot());
    resetHostView();
  }
  async function switchHost(target: Host) {
    setSwitcher(false);
    setAdding(false);
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
  // Forget a saved computer that is not open: its pairing and cached history leave this phone.
  async function forgetHost(target: Host) {
    if (client && host && hostKey(host) === hostKey(target)) return;
    const rest = removeHost(hosts, target);
    await tokenStoreFor(target.slot).clear();
    await clearCache(target.serverId);
    await writeCache("app", "hosts", rest);
    setHosts(rest);
  }
  function addHost() {
    setSwitcher(false);
    setPairingSlot(newSlot());
    setAdding(true);
  }
  async function disconnect() {
    if (client) conversationStreams.clear(client);
    if (host) { await writeCache(host.serverId, 'backgroundOptIn', false); await writeCache(host.serverId, 'pushOptIn', false); }
    const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),3000);
    try { await Promise.allSettled([stopBackgroundNotifications(allows('notifications-background-unregister') ? client || undefined : undefined), allows('notifications-preferences') ? client?.action('notifications-preferences',{enabled:false,categories:[]},{signal:controller.signal}) : undefined]); }
    finally { clearTimeout(timer); }
    if (client) await client.logout();
    else if (host) await tokenStoreFor(host.slot).clear();
    const rest = host ? removeHost(hosts, host) : hosts;
    await writeCache("app", "hosts", rest);
    await writeCache("app", "activeHost", null);
    setHosts(rest);
    setClient(null);
    setHost(null);
    resetHostView();
    // Continue with another saved computer when there is one.
    if (rest[0]) await switchHost(rest[0]);
  }
  // Notification taps for another saved computer, or any tap that launched the
  // app before a computer was open: switch to its computer, then open the chat.
  // Taps for the open computer are handled by useNotifications.
  const pendingNotification = useRef<{ serverId: string; conversationId: string; switching?: boolean } | null>(null);
  const [notificationRevision, setNotificationRevision] = useState(0);
  const openServerId = useRef<string | undefined>(undefined);
  openServerId.current = client ? host?.serverId : undefined;
  useEffect(() => notificationResponses(data => {
    if (typeof data.serverId !== "string" || typeof data.conversationId !== "string") return;
    if (data.serverId === openServerId.current) return;
    pendingNotification.current = { serverId: data.serverId, conversationId: data.conversationId };
    setNotificationRevision(value => value + 1);
  }), []);
  useEffect(() => {
    const pending = pendingNotification.current;
    if (!pending || loading) return;
    if (client && host?.serverId === pending.serverId) {
      if (!workspace.conversations.length) return;
      pendingNotification.current = null;
      choose(pending.conversationId);
      return;
    }
    if (pending.switching) return;
    const target = hosts.find(item => item.serverId === pending.serverId);
    if (!target) { pendingNotification.current = null; return; }
    pending.switching = true;
    void switchHost(target).then(switched => {
      if (!switched && pendingNotification.current === pending) pendingNotification.current = null;
    });
  }, [notificationRevision, loading, client, host, hosts, workspace.conversations]);
  const notificationInbox = useNotifications(client, host?.serverId, workspace.online, choose, route.page === "chat" ? selected || undefined : undefined, workspace.team.mobileCapabilities);
  function choose(id: string) {
    const found = workspace.conversations.find(
      (item) =>
        item.id === id || item.id === `bot:${id}` || item.id === `room:${id}`,
    );
    const conversationId = found?.id || id;
    setSelected(conversationId);
    setChatOpening(previous => ({ id: conversationId, revision: previous.revision + 1 }));
    setNewChat(false);
    navigator.open({ page: "chat", id: conversationId });
  }
  function navigate(value: Route) {
    if (value.page === "home" && route.page !== "home") homeScrollRestoration.restore();
    setNewChat(false);
    navigator.open(value);
  }
  const mainIds = workspace.team.mainBotIds?.length
    ? workspace.team.mainBotIds
    : workspace.team.mainBotId
      ? [workspace.team.mainBotId]
      : [];
  const chief = workspace.team.bots.find((bot) => bot.id === mainIds[0]);
  const conversation = selectConversation(workspace.conversations, selected, classic, chief?.sessionId);
  function details(item = conversation) {
    if (!item) return;
    if (item.kind === "agent") {
      navigate({ page: "agent" });
      return;
    }
    const bot = workspace.team.bots.find(
      (bot) => bot.id === item.id || bot.sessionId === item.sessionId,
    );
    const room = workspace.team.rooms.find(
      (room) => room.id === item.id || `room:${room.id}` === item.id,
    );
    if (bot) navigate({ page: "team", section: "bots", id: bot.id });
    else if (room) navigate({ page: "team", section: "groups", id: room.id });
  }
  // Opens the team's DSH Agent, creating it on the computer the first time.
  async function addAgent() {
    if (!client || !agentAccess) return;
    setCreating(true);
    setError("");
    try {
      const result = await client.action<{ conversationId: string }>("agent-open", {});
      await workspace.refresh({ fresh: true });
      if (result?.conversationId) choose(result.conversationId);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setCreating(false);
    }
  }
  const showNavigation = () => { navigator.back(); void workspace.refresh(); };
  const sorted = orderConversations(workspace.conversations
    .filter((c) => {
      if (classic && c.kind !== "agent") return false;
      if (c.kind === "room" && workspace.team.mobileCapabilities?.groups === false) return false;
      const bot = workspace.team.bots.find(
        (b) => b.id === c.id || b.sessionId === c.sessionId,
      );
      const room = workspace.team.rooms.find((r) => r.id === c.id);
      const agent = workspace.team.agents?.find((a) => a.id === c.agentId);
      const isMain = !!bot && mainIds.includes(bot.id);
      const hidden = c.hidden || bot?.hidden || room?.hidden || agent?.hidden;
      return (
        (!hidden || c.id === conversation?.id || isMain) &&
        (!query ||
          `${c.name} ${c.role || ""}`
            .toLowerCase()
            .includes(query.toLowerCase()))
      );
    }), previews, (c) => {
      const item = workspace.team.bots.find(x => x.id === c.id || x.sessionId === c.sessionId)
        || workspace.team.rooms.find(x => x.id === c.id)
        || workspace.team.agents?.find(x => x.id === c.agentId);
      return !!(c.pinned || item?.pinned);
    });
  const conversationActivity = JSON.stringify(workspace.conversations.map(item => [item.id, item.sessionId, item.updatedAt]));
  useEffect(() => {
    if (route.page !== "home" || !host) return;
    let alive = true;
    const controller = new AbortController();
    void Promise.all(orderConversations(workspace.conversations, previews, () => false).slice(0,20).map(async item => {
      let messages = await cache.getMessages(host.serverId, item.id);
      if (workspace.online && client) {
        try { messages = (await client.messages(item.id,{limit:6,signal:controller.signal})).messages; }
        catch { /* Keep this host's cached preview when a read fails. */ }
      }
      const latest = [...messages].reverse().find(message => !message.pending && ['assistant','user'].includes(message.role) && (!!message.text || !!message.attachments?.length));
      return latest ? [item.id, latest] as const : null;
    })).then(rows => {
      if (!alive) return;
      const liveIds = new Set(workspace.conversations.map(item => item.id));
      setPreviewState(previous => {
        const retained = previous?.serverId === host.serverId ? previous.items : {};
        return { serverId: host.serverId, items: {
          ...Object.fromEntries(Object.entries(retained).filter(([id]) => liveIds.has(id))),
          ...Object.fromEntries(rows.filter(row => row !== null)),
        } };
      });
    }).catch(() => {});
    return () => { alive = false; controller.abort(); };
  }, [route.page, host, client, workspace.online, conversationActivity, notificationInbox?.cursor]);
  function unread(item:Conversation) {
    return !!notificationInbox?.items.some(event => !event.read && (event.conversationId === item.id || item.id === `bot:${event.conversationId}` || item.id === `room:${event.conversationId}`));
  }
  const unreadAboveAt = (y: number) => y > 120 ? sorted.filter(item => unread(item) && rowPositions.current[item.id] && rowPositions.current[item.id].y + rowPositions.current[item.id].height < y + 110) : [];
  const unreadAbove = unreadAboveAt(homeScroll.current);
  const homeScrollRestoration = useRef(createHomeScrollRestoration()).current;
  function conversationRow(item: Conversation) {
    const bot = workspace.team.bots.find(
      (b) => b.id === item.id || b.sessionId === item.sessionId,
    );
    const room = workspace.team.rooms.find((r) => r.id === item.id);
    const main = !!bot && mainIds.includes(bot.id);
    const active = item.id === conversation?.id;
    const lastActivity = conversationTime(item, previews[item.id]);
    const needsApproval = workspace.team.work?.approvals.some(entry => bot ? entry.botId === bot.id && !entry.roomId : room ? entry.roomId === room.id : false);
    const work = bot ? ownBotWork(bot.id, workspace.team) : room ? groupWorkMembers(room, workspace.team).find(member => member.work)?.work : undefined;
    const workPreview = needsApproval ? tr("Waiting for approval") : work?.switching ? tr("Moving to a fresh conversation") : workDescription(work) || (work ? tr("Working") : "");
    const time = lastActivity ? (new Date(lastActivity).toLocaleDateString() === new Date().toLocaleDateString()
      ? new Date(lastActivity).toLocaleTimeString(locale === "zh" ? "zh-CN" : "en-US",{hour:"2-digit",minute:"2-digit"})
      : new Date(lastActivity).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US",{month:"short",day:"numeric"})) : "";
    const unread = notificationInbox?.items.some(event => !event.read && (event.conversationId === item.id || item.id === `bot:${event.conversationId}` || item.id === `room:${event.conversationId}`));
    return (
      <ListRow
        key={item.id}
        onLayout={event => {rowPositions.current[item.id]=event.nativeEvent.layout;}}
        accessibilityLabel={tr("Open {p0}", { p0: String(item.name) })}
        selected={active}
        onPress={() => choose(item.id)}
        onLongPress={() => {
          setSelected(item.id);
          details(item);
        }}
        leading={bot ? (
          <BotAvatar bot={bot} size={52} main={main} live={!!item.waiting} />
        ) : room ? (
          <RoomAvatar room={room} team={workspace.team} size={52} />
        ) : (
          <View style={{ width: 52, alignItems: "center" }}>
            <Icon name="bots" color={t.muted} />
          </View>
        )}
        title={item.name || tr("New conversation")}
        tags={[needsApproval ? { text: tr("Waiting for approval"), strong: true } : bot?.role]}
        meta={time}
        subtitle={workPreview || previews[item.id]?.text.replace(/\s+/g," ").trim() || (previews[item.id]?.attachments?.length ? tr("Attachment message") : "") || (typeof item.preview === "string" && item.preview) ||
          (item.waiting ? tr("Waiting for your answer") : bot?.role || (room ? room.members.map(id => workspace.team.bots.find(b => b.id === id)?.name || id).join(" · ") : tr("DSH Agent")))}
        trailing={unread
          ? <View accessibilityLabel={tr("Unread")} style={{width:11,height:11,borderRadius:6,backgroundColor:t.accent}}/>
          : (item.pinned || bot?.pinned || room?.pinned) ? <Icon name="pin" size={14} color={t.faint}/> : null}
      />
    );
  }
  function renderPage(route: Route, focused: boolean) {
    const active = focused && foreground;
    const online = workspace.online && active;
    const conversation = selectConversation(workspace.conversations, route.page === "chat" ? route.id || selected : selected, classic, chief?.sessionId);
    return (
    <ScreenActivity.Provider value={active}>
    {/* Signed-in pages own their bottom inset: CreationScreen pads its footer and both group steps. */}
    <SafeAreaView edges={loading || !client || !host || adding || route.page === "agent" ? undefined : ["top", "left", "right"]} style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar barStyle={t.dark ? "light-content" : "dark-content"} />
      <View
        accessibilityElementsHidden={intro}
        importantForAccessibility={intro ? "no-hide-descendants" : "auto"}
        style={{
          flex: 1,
          opacity: intro ? 0 : 1,
          width: "100%",
          maxWidth: 860,
          alignSelf: "center",
          borderLeftWidth: Platform.OS === "web" ? 1 : 0,
          borderRightWidth: Platform.OS === "web" ? 1 : 0,
          borderColor: t.line,
        }}
      >

        {loading ? (
          <Busy text={tr("Opening your workspace…")} />
        ) : !client || !host || adding ? (
          <>
            <Notice error text={error} />
            <PairingScreen
              key={pairingSlot}
              slot={pairingSlot}
              onConnected={connected}
              onCancel={client ? () => setAdding(false) : hosts.length ? () => setSwitcher(true) : undefined}
            />
          </>
        ) : route.page === "home" ? (
          <View style={{flex:1}}>
            <AmbientGlow behindTop={insets.top}/>
            <View pointerEvents="box-none" style={{position:"absolute",top:0,left:0,right:0,zIndex:2,flexDirection:"row",alignItems:"center",paddingHorizontal:20,paddingTop:16,paddingBottom:12,gap:10}}>
              <View pointerEvents="box-none" style={{flex:1,alignItems:"flex-start"}}>
                <HostPill name={host.name} online={workspace.online} onPress={() => setSwitcher(true)}/>
              </View>
              <IconButton name="plus" floating label={tr("New chat")} onPress={() => setNewChat(true)}/>
            </View>
            <Notice error text={workspace.error || error}/>
            {unreadAbove.length > 0 && <Pressable accessibilityRole="button" accessibilityLabel={tr("{count} unread",{count:unreadAbove.length})} onPress={() => {const first=unreadAbove[0];homeList.current?.scrollTo({y:Math.max(0,rowPositions.current[first.id].y-110),animated:true});}} style={{position:"absolute",top:88,alignSelf:"center",zIndex:3,backgroundColor:t.accent,borderRadius:24,paddingHorizontal:14,minHeight:44,flexDirection:"row",alignItems:"center",gap:6}}><Icon name="up" size={18} color={t.accentText}/><Text style={{fontSize:18,fontWeight:"600",color:t.accentText}}>{tr("{count} unread",{count:unreadAbove.length})}</Text></Pressable>}
            <ScrollView ref={homeList} contentOffset={homeScrollRestoration.initialOffset} onScroll={event => {const y=event.nativeEvent.contentOffset.y;homeScrollRestoration.observe(y);homeScroll.current=y;setUnreadAboveKey(unreadAboveAt(y).map(item => item.id).join("\n"));}} scrollEventThrottle={80} contentContainerStyle={{paddingHorizontal:8,paddingTop:72,paddingBottom:dockBottom(insets.bottom) + DOCK_HEIGHT + 28}} keyboardShouldPersistTaps="handled">
              {sorted.map(conversationRow)}
              {!sorted.length && <View style={{padding:24,gap:16}}><Label muted>{tr("No conversations found.")}</Label>{classic ? <><Button title={tr("New DSH Agent")} disabled={creating || !workspace.online || !agentAccess} onPress={addAgent}/><Button secondary title={tr("Back to Bot team")} onPress={() => void localPreferences({ classic: false }).catch(err => setError(errorText(err)))}/></> : <Button secondary title={tr("Reconnect")} onPress={workspace.refresh}/>}</View>}
            </ScrollView>
            <EdgeFade edge="top" height={72}/>
            <HomeDock query={query} onQuery={setQuery} onSettings={() => navigate({ page: "settings" })}/>
          </View>
        ) : route.page === "chat" ? (
          conversation ? (
            <ChatScreen
              key={`${host.serverId}:${conversation.id}`}
              client={client}
              host={host}
              conversation={conversation}
              active={active}
              openRevision={chatOpening.id === conversation.id ? chatOpening.revision : 0}
              conversations={workspace.conversations}
              select={choose}
              team={workspace.team}
              refresh={workspace.refresh}
              online={online}
              transcription={workspace.transcription}
              onOpenNavigation={showNavigation}
              onOpenDetails={() => details(conversation)}
            />
          ) : (
            <>
              <PageHeader title={tr("DS Bot")} onOpenNavigation={showNavigation} />
              <View
                style={{
                  flex: 1,
                  justifyContent: "center",
                  alignItems: "center",
                  padding: 24,
                  gap: 18,
                }}
              >
                <BotAvatar bot={mainLook} size={64} />
                <Label large>
                  {tr(
                    classic
                      ? "No Agent conversations yet"
                      : "Your team is getting ready",
                  )}
                </Label>
                <Notice error text={workspace.error || error} />
                {classic ? (
                  <>
                    <Button
                      title={tr("New DSH Agent")}
                      onPress={addAgent}
                      disabled={creating || !workspace.online || !agentAccess}
                    />
                    <Button secondary title={tr("Back to Bot team")} onPress={() => void localPreferences({ classic: false }).catch(err => setError(errorText(err)))} />
                  </>
                ) : (
                  <Button title={tr("Reconnect")} onPress={workspace.refresh} />
                )}
              </View>
            </>
          )
        ) : route.page === "team" && route.create ? (
          <CreationScreen key={route.create} kind={route.create} client={client} team={workspace.team} online={online} refresh={workspace.refresh} openConversation={choose} onClose={showNavigation}/>
        ) : route.page === "team" ? (
          <TeamScreen
            key={`${route.section}:${route.id || ""}:${route.create || ""}`}
            client={client}
            team={workspace.team}
            refresh={workspace.refresh}
            openConversation={choose}
            online={online}
            onCreate={(kind) => navigate({page:"team",section:kind === "bot" ? "bots" : "groups",create:kind})}
            initialSection={route.section}
            initialId={route.id}
            initialPage={route.subpage}
            onNavigatePage={(subpage, id, section) => navigate({ page: "team", section, id, subpage })}
            create={route.create}
            onBack={showNavigation}
          />
        ) : route.page === "agent" ? (
          <AgentDetails
            key={conversation?.id}
            client={client}
            team={workspace.team}
            conversations={workspace.conversations}
            conversation={conversation}
            online={online}
            refresh={() => workspace.refresh({ fresh: true })}
            openConversation={choose}
            onBack={showNavigation}
          />
        ) : (
          <SettingsScreen
            key={route.initial || "index"}
            client={client}
            host={host}
            team={workspace.team}
            disconnect={disconnect}
            online={online}
            refresh={refreshSettings}
            initialPage={route.initial}
            onNavigatePage={initial => navigate({ page: "settings", initial })}
            openConversation={choose}
            openTeam={(section) => navigate({ page: "team", section })}
            onBack={showNavigation}
            classic={classic}
            classicAvailable={agentsAvailable}
            onClassicChange={(value) => {
              void localPreferences({ classic: value }).catch((err) =>
                setError(errorText(err)),
              );
            }}
            onLocaleChange={(value) => {
              void localPreferences({ locale: value }).catch((err) =>
                setError(errorText(err)),
              );
            }}
          />
        )}
      </View>
    </SafeAreaView>
    </ScreenActivity.Provider>
    );
  }
  return <View style={{flex:1,backgroundColor:t.bg}}>
    <NativeNavigation navigator={navigator} onRoute={setRoute} render={renderPage}/>
    {intro && <LaunchIntro onComplete={() => setIntro(false)}/>}
      <Sheet title={tr("New chat")} visible={newChat && !!client} onClose={() => setNewChat(false)}>
        {(!allows("create-bot") || !allows("create-room")) && <Notice text={BRIDGE_UNAVAILABLE}/>}<SettingRow title={tr("New Bot")} disabled={!allows("create-bot")} leading={<Icon name="bots"/>} onPress={() => navigate({page:"team",section:"bots",create:"bot"})}/>
        <SettingRow title={tr("New group chat")} leading={<Icon name="groups"/>} disabled={workspace.team.bots.length<2 || !allows("create-room")} onPress={() => navigate({page:"team",section:"groups",create:"group"})}/>
        <SettingRow title={tr(creating ? "Creating Agent…" : "New DSH Agent")} hint={allows("agent-open") && !agentAccess ? tr("Allow this phone to use the DSH Agent on the computer first, under the paired devices of DS Bot Mobile.") : undefined} leading={<Icon name="plus"/>} disabled={creating || !workspace.online || !agentAccess} onPress={addAgent} last/>
      </Sheet>
      <HostSheet visible={switcher} hosts={hosts} current={client ? host : null} online={workspace.online}
        onClose={() => setSwitcher(false)} onSwitch={item => void switchHost(item)} onAdd={addHost}
        onRemove={item => void forgetHost(item).catch(err => setError(errorText(err)))}/>
  </View>;
}
export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider><MotionProvider><Shell /></MotionProvider></KeyboardProvider>
    </SafeAreaProvider>
  );
}
