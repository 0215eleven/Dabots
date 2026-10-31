import { EdgeFade } from "../components/Glass";
import { AvatarEditor } from "../components/AvatarEditor";
import { MyAvatar, MyLookPersistence, meAsBot, resetMyLook, updateMyLook, useMyLook } from "../components/MyAvatar";
import { AboutPanel } from "../host-settings/AboutPanel";
import { PluginUpdateCard } from "../host-settings/PluginUpdateCard";
import { CapabilitiesPanel } from "../host-settings/CapabilitiesPanel";
import { SkillsPanel } from "../host-settings/SkillsPanel";
import { PluginsPanel } from "../host-settings/PluginsPanel";
import { NotificationsPanel } from "../components/NotificationsPanel";
import { tr } from "../i18n";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { AnimatedPressable as Pressable } from "../components/Motion";
import { Device, MobileClient } from "@ds-bot/mobile-sdk";
import {
  Button,
  Field,
  Icon,
  IconName,
  Label,
  Notice,
  PageHeader,
  useBottomClearance,
  Section,
  SettingRow,
  Sheet,
  Tag,
  styles,
} from "../components/UI";
import { inks } from "../components/BotAvatar";
import { SchedulesPanel, UsagePanel } from "../features";
import { HostSettingsPanel } from "../host-settings/HostSettingsPanel";
import { Host, tokenStoreFor, writeCache } from "../storage";
import { errorText, TeamState } from "../types";
import { ColorMode, setColorMode, THEMES, useColorMode, useTheme } from "../theme";
import { PageTransition } from "../components/Motion";
import { LocalePreference, useI18n } from "../i18n";
import { groupDevices, isStale, relativeDay } from "../logic/devices";
import { hostAddress } from "../logic/hosts";
import { mobileActionAllowed, mobilePanelAllowed, BRIDGE_UNAVAILABLE } from "../logic/mobile-access";
export type SettingsPage =
  | "tools"
  | "capabilities"
  | "skills"
  | "plugins"
  | "notifications"
  | "index"
  | "general"
  | "mobile"
  | "schedules"
  | "usage"
  | "connectors"
  | "secrets"
  | "feedback"
  | "about"
  | "updates"
  | "harness";
const pages: {
  id: SettingsPage | "bots" | "groups";
  title: string;
  icon: IconName;
}[] = [
  { id: "notifications", title: "Notifications", icon: "bell" },
  { id: "general", title: "General", icon: "settings" },
  { id: "bots", title: "Bots", icon: "bots" },
  { id: "groups", title: "Group chats", icon: "groups" },
  { id: "mobile", title: "Mobile devices", icon: "devices" },
  { id: "connectors", title: "Connectors", icon: "connectors" },
  { id: "schedules", title: "Scheduled tasks", icon: "schedules" },
  { id: "usage", title: "Usage", icon: "usage" },
  { id: "secrets", title: "Secrets", icon: "secrets" },
  { id: "feedback", title: "Feedback", icon: "feedback" },
  { id: "about", title: "About Dabots", icon: "feedback" },
  { id: "updates", title: "Plugin updates", icon: "download" },
  { id: "harness", title: "Harness settings", icon: "settings" },
];
export function SettingsScreen({
  client,
  host,
  team,
  disconnect,
  online,
  refresh,
  initialPage = "index",
  onNavigatePage,
  openTeam,
  openConversation,
  onOpenNavigation,
  onBack,
  classic = false,
  classicAvailable = true,
  onClassicChange,
  onLocaleChange,
}: {
  client: MobileClient;
  host: Host;
  team: TeamState;
  disconnect: () => Promise<void>;
  online: boolean;
  refresh: () => Promise<void>;
  initialPage?: SettingsPage;
  onNavigatePage?: (page: SettingsPage) => void;
  openConversation?: (id: string) => void;
  openTeam?: (section: "bots" | "groups") => void;
  onOpenNavigation?: () => void;
  onBack?: () => void;
  classic?: boolean;
  /** Whether this computer offers DSH Agents to the phone at all. */
  classicAvailable?: boolean;
  onClassicChange?: (value: boolean) => void;
  onLocaleChange?: (value: LocalePreference) => void;
}) {
  const t = useTheme();
  const colorMode = useColorMode();
  function chooseColorMode(value: ColorMode) {
    setColorMode(value);
    void writeCache("app", "colorMode", value).catch(() => {});
  }
  const Transition = onNavigatePage ? View : PageTransition;
  const { tr, preference } = useI18n();
  const [page, setLocalPage] = useState<SettingsPage>(initialPage);
  const setPage = (value: SettingsPage) => onNavigatePage ? onNavigatePage(value) : setLocalPage(value);
  const [toolsChild,setToolsChild] = useState(false);
  const [devices, setDevices] = useState<Device[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [customAccent, setCustomAccent] = useState("");
  const [editingLook, setEditingLook] = useState(false);
  const myLook = useMyLook();
  const [confirm, setConfirm] = useState<{
    title?: string;
    text: string;
    /** The confirming button's label, naming what happens. */
    action?: string;
    danger?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const locked = busy || !online || !!team.readOnly;
  const allows = (action: string) => mobileActionAllowed(team.mobileCapabilities, action);
  const panelAllowed = (name: string) => mobilePanelAllowed(team.mobileCapabilities, name);
  const activePage = panelAllowed(page) ? page : null;
  const prefsLocked = locked || !allows("set-prefs");
  const bottomClearance = useBottomClearance();
  const now = Date.now();
  const when = (value: unknown) => { const day = relativeDay(value, now); return day ? tr(day[0], day[1]) : ""; };
  const { current: thisDevice, others: otherDevices } = groupDevices(devices, deviceId);
  const deviceName = (device: Device) => device.name || device.deviceName || tr("Paired device");
  const unavailableHere = ["usage", "tools", "schedules", "notifications", "updates", "connectors", "secrets", "feedback", "harness"].some(name => !panelAllowed(name));
  async function loadDevices() {
    setError("");
    try {
      const [result, session] = await Promise.all([
        client.devices(),
        tokenStoreFor(host.slot).get(),
      ]);
      setDevices(result.devices.filter((d) => !d.revokedAt));
      setDeviceId(String((result as { currentDeviceId?: unknown }).currentDeviceId || session?.deviceId || ""));
    } catch (err) {
      setError(errorText(err));
    }
  }
  useEffect(() => {
    if (online && page === "mobile") void loadDevices();
  }, [client, page, online]);
  async function perform(run: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await run();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }
  const loadAfter = (run: () => Promise<unknown>) => async () => { await run(); await loadDevices(); };
  function prefs(patch: Record<string, unknown>) {
    if (prefsLocked) return;
    void perform(async () => {
      await client.action("set-prefs", patch);
      await refresh();
    });
  }
  function back() {
    if (onNavigatePage) { onBack?.(); return; }
    setError("");
    setNotice("");
    if (toolsChild && ["skills","plugins","connectors","capabilities"].includes(page)) {setPage("tools");setToolsChild(false);}
    else if (page !== "index") setPage("index");
    else onBack?.();
  }
  return (
    <View style={{ flex: 1 }}>
      <PageHeader
        title={tr(
          activePage === "index"
            ? "Settings"
            : ({tools:"Tools & skills",skills:"Skills",plugins:"Plugins",capabilities:"Capabilities"}[page as "tools"|"skills"|"plugins"|"capabilities"] || pages.find((p) => p.id === page)?.title || "Settings"),
        )}
        onBack={page !== "index" || onBack ? back : undefined}
        floating
      />
      <Transition key={page}>
      <ScrollView
        key={page}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.page, {paddingTop:92,paddingBottom:bottomClearance}, activePage === "index" ? {paddingHorizontal:16,paddingTop:80,gap:28} : undefined]}
      >
        <Notice error text={error} />
        <Notice text={!activePage ? BRIDGE_UNAVAILABLE : ""} />
        <Notice text={notice} />
        {activePage === "index" && (
          <>
            <View style={{backgroundColor:t.card,borderRadius:22,borderWidth:0.5,borderColor:t.cardEdge,overflow:"hidden"}}>
              <SettingRow title={tr("Me")} hint={tr("Your avatar on this phone")} leading={<MyAvatar size={44} name={tr("Me")}/>} onPress={() => setEditingLook(true)} last/>
            </View>
            <View style={{backgroundColor:t.card,borderRadius:22,borderWidth:0.5,borderColor:t.cardEdge,overflow:"hidden"}}>
              <Pressable accessibilityRole="button" accessibilityLabel={tr("Connected host")} onPress={() => setPage("mobile")} style={({pressed}) => ({flexDirection:"row",alignItems:"center",gap:14,minHeight:76,paddingHorizontal:20,paddingVertical:14,backgroundColor:pressed ? t.hover : undefined})}>
                <View style={{width:44,height:44,borderRadius:22,backgroundColor:t.hover,alignItems:"center",justifyContent:"center"}}><Icon name="server" size={20} color={t.ink}/></View>
                <View style={{flex:1,gap:3}}>
                  <Text numberOfLines={1} style={{fontSize:19,fontWeight:"600",color:t.ink}}>{host.name || "Dabots"}</Text>
                  <ConnectionState online={online}/>
                </View>
                <Icon name="chevron" size={16} color={t.faint}/>
                <View pointerEvents="none" style={{position:"absolute",left:78,right:0,bottom:0,height:StyleSheet.hairlineWidth,backgroundColor:t.lineStrong}}/>
              </Pressable>
              <SettingRow title={tr("Usage")} unavailable={!panelAllowed("usage")} compact onPress={() => setPage("usage")} last/>
            </View>
            <View style={{backgroundColor:t.card,borderRadius:22,borderWidth:0.5,borderColor:t.cardEdge,overflow:"hidden"}}><SettingRow title={tr("Tools & skills")} unavailable={!panelAllowed("tools")} hint={tr("Dabots tools, skills and plugins")} onPress={() => setPage("tools")} last/></View>
            <Section title={tr("Team")}>
              <SettingRow title={tr("Bots")} hint={team.bots.length ? team.bots.slice(0, 4).map(bot => bot.name).join("、") + (team.bots.length > 4 ? " …" : "") : undefined}
                leading={<Icon name="bots" size={20} color={t.accent}/>} onPress={() => openTeam?.("bots")}/>
              <SettingRow title={tr("Group chats")} hint={team.rooms.length ? team.rooms.slice(0, 3).map(room => room.name).join("、") + (team.rooms.length > 3 ? " …" : "") : undefined}
                leading={<Icon name="groups" size={20} color={t.accent}/>} unavailable={team.mobileCapabilities?.groups === false} onPress={() => openTeam?.("groups")} last/>
            </Section>
            <Section title={tr("Bot")}>
              <SettingRow title={tr("Scheduled tasks")} unavailable={!panelAllowed("schedules")} onPress={() => setPage("schedules")}/>
              {/* A phone-only preference, so it never waits on the host. */}
              {classicAvailable && <SettingRow title={tr("Classic Agent mode")} hint={tr("Show DSH Agent conversations on the home screen.")}><Switch accessibilityLabel={tr("Classic Agent mode")} value={classic} onValueChange={onClassicChange} trackColor={{false:t.lineStrong,true:t.accent}}/></SettingRow>}
              <SettingRow title={tr("Bot computer")} onPress={() => setPage("mobile")} last/>
            </Section>
            <Section title={tr("Preferences")}>
              <SettingRow title={tr("Notifications")} unavailable={!panelAllowed("notifications")} onPress={() => setPage("notifications")}/>
              <SettingRow title={tr("Appearance")} onPress={() => setPage("general")}/>
              <SettingRow title={tr("Language")} onPress={() => setPage("general")}/>
              <SettingRow title={tr("Plugin updates")} unavailable={!panelAllowed("updates")} onPress={() => setPage("updates")}/>
              <SettingRow title={tr("About Dabots")} onPress={() => setPage("about")} last/>
            </Section>
            <Section title={tr("Host")} footer={unavailableHere ? tr("Items marked “On computer” need a newer Dabots Bridge on this computer. Until then, open them on the computer.") : undefined}>
              {pages.filter(item => ["connectors","secrets","feedback","harness"].includes(item.id)).map((item,index)=><SettingRow key={item.id} title={tr(item.title)} unavailable={!panelAllowed(item.id)} onPress={() => setPage(item.id as SettingsPage)} last={index===3}/>)}
            </Section>
            <Text style={{ textAlign: "center", fontSize: 12, color: t.faint }}>
              {tr("Dabots")}</Text>
          </>
        )}
        {activePage === "tools" && <Section title={tr("Tools & skills")}><SettingRow title={tr("Skills")} unavailable={!panelAllowed("skills")} onPress={() => {setToolsChild(true);setPage("skills");}}/><SettingRow title={tr("Plugins")} unavailable={!panelAllowed("plugins")} onPress={() => {setToolsChild(true);setPage("plugins");}}/><SettingRow title={tr("Connectors")} unavailable={!panelAllowed("connectors")} onPress={() => {setToolsChild(true);setPage("connectors");}}/><SettingRow title={tr("Capabilities")} unavailable={!panelAllowed("capabilities")} onPress={() => {setToolsChild(true);setPage("capabilities");}} last/></Section>}
        {activePage === "capabilities" && <CapabilitiesPanel client={client} team={team} online={online} refresh={refresh}/>}
        {activePage === "skills" && <SkillsPanel client={client} team={team} online={online} refresh={refresh}/>}
        {activePage === "plugins" && <PluginsPanel client={client} team={team} online={online} refresh={refresh}/>}
        {activePage === "notifications" && <NotificationsPanel serverId={host.serverId} client={client} online={online} open={openConversation} capabilities={team.mobileCapabilities} />}
        {activePage === "general" && (
          <>
            <Section title={tr("Light and dark")} footer={tr("Applies to this phone only.")}>
              {([["system", "Follow system"], ["dark", "Dark mode"], ["light", "Light mode"]] as const).map(([value, label], index) => (
                <SettingRow key={value} title={tr(label)} last={index === 2} selected={colorMode === value}
                  accessibilityLabel={tr(label)} onPress={() => chooseColorMode(value)} />
              ))}
            </Section>
            <Section title={tr("Theme")} footer={allows("set-prefs") ? tr("Colors for the whole team, on every device.") : tr("This computer's Bridge can't change team colors from the phone. Update Dabots Bridge, or change them on the computer.")}>
                {Object.entries(THEMES).map(([key, theme], index, all) => (
                  <SettingRow
                    key={key}
                    title={tr(theme.name)}
                    onPress={() => prefs({ theme: key })}
                    disabled={prefsLocked}
                    selected={(team.prefs?.theme || "deepseek") === key}
                    last={index === all.length - 1}
                  >
                    <View style={{ flexDirection: "row", gap: 4 }}>
                      {[
                        theme.light[0],
                        theme.light[2],
                        theme.light[5],
                        theme.light[7],
                      ].map((color, i) => (
                        <View
                          key={i}
                          style={{
                            width: 15,
                            height: 20,
                            borderRadius: 4,
                            backgroundColor: color,
                            borderWidth: 1,
                            borderColor: t.lineStrong,
                          }}
                        />
                      ))}
                    </View>
                  </SettingRow>
                ))}
            </Section>
            <Section title={tr("Accent")} footer={tr("Unread marks, badges, and the brand.")}>
              <View style={{ padding: 12, gap: 12 }}>
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}
                >
                  {[
                    null,
                    "deepseek",
                    "charcoal",
                    "graphite",
                    "rose",
                    "sky",
                    "tangerine",
                    "cobalt",
                  ].map((name) => {
                    const color = name ? inks[name][t.dark ? 1 : 0] : null;
                    const selected = color
                      ? team.prefs?.accent === color
                      : !team.prefs?.accent;
                    return (
                      <Pressable
                        key={name || "default"}
                        accessibilityRole="button"
                        accessibilityLabel={tr("Accent {p0}", { p0: String(name || tr("Default")) })}
                        accessibilityState={{ selected }}
                        disabled={prefsLocked}
                        onPress={() => prefs({ accent: color })}
                        style={{
                          width: 44,
                          height: 44,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <View
                          style={{
                            width: 26,
                            height: 26,
                            borderRadius: 13,
                            backgroundColor: color || t.surface,
                            borderWidth: selected ? 3 : 1,
                            borderColor: selected ? t.ink : t.lineStrong,
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          {!name && (
                            <Text style={{ color: t.muted, fontSize: 20 }}>
                              ∕
                            </Text>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <Field
                  label={tr("Custom accent")}
                  placeholder="#3964FE"
                  autoCapitalize="none"
                  maxLength={7}
                  value={customAccent}
                  onChangeText={setCustomAccent}
                />
                <Button
                  title={tr("Apply accent")}
                  secondary
                  disabled={prefsLocked || !/^#[0-9a-f]{6}$/i.test(customAccent)}
                  onPress={() => prefs({ accent: customAccent })}
                />
              </View>
            </Section>
            <Section title={tr("Character animation")} footer={tr("How lively your Bots feel.")}>
              {(["quiet", "normal", "lively"] as const).map((motion, index) => (
                <SettingRow key={motion} title={tr(motion[0].toUpperCase() + motion.slice(1))}
                  selected={(team.prefs?.motion || "normal") === motion} disabled={prefsLocked}
                  onPress={() => prefs({ motion })} last={index === 2} />
              ))}
            </Section>
            <Section title={tr("Language")}>
              {(
                [
                  { value: "host", label: tr("Follow host") },
                  { value: "system", label: tr("Follow system") },
                  { value: "en", label: tr("English") },
                  { value: "zh", label: "简体中文" },
                ] as const
              ).map((item) => (
                <SettingRow
                  key={item.value}
                  title={tr(item.label)}
                  onPress={() => onLocaleChange?.(item.value)}
                  selected={preference === item.value}
                  last={item.value === "zh"}
                />
              ))}
            </Section>
            {classicAvailable && <Section title={tr("Mode")}>
              <SettingRow
                title={tr("Classic Agent mode")}
                hint={tr(
                  "Show DSH Agent conversations on the home screen.",
                )}
                last
              >
                <Button
                  title={tr(classic ? "Bot team" : "Switch")}
                  secondary
                  compact
                  onPress={() => onClassicChange?.(!classic)}
                />
              </SettingRow>
            </Section>}
          </>
        )}
        {activePage === "mobile" && (
          <>
            <Section title={tr("Computer")}>
              <SettingRow title={host.name} hint={hostAddress(host)}>
                <ConnectionState online={online} compact />
              </SettingRow>
              <SettingRow
                title={tr("Keep your host running")}
                hint={tr(
                  "Work accepted by the host can continue while your phone is in the background.",
                )}
                last
              />
            </Section>
            <Section title={tr("This phone")}>
              <SettingRow
                title={thisDevice ? deviceName(thisDevice) : tr("This device")}
                hint={thisDevice ? tr("Paired {when}", { when: when(thisDevice.createdAt) }) : undefined}
                leading={<Icon name="devices" size={20} color={t.accent} />}
              >
                <Tag>{tr("This device")}</Tag>
              </SettingRow>
              <SettingRow
                title={tr("Clear cached history and drafts")}
                disabled={busy}
                onPress={() =>
                  setConfirm({
                    title: tr("Clear cached history and drafts"),
                    text: tr(
                      "Clear cached messages and drafts on this device? Unresolved sends and their drafts are retained until the host confirms their outcome.",
                    ),
                    action: tr("Clear"),
                    run: async () => {
                      await client.clearCachedData();
                      setNotice(
                        tr(
                          "Local cache cleared. Reopening a conversation downloads its history again.",
                        ),
                      );
                    },
                  })
                }
              />
              <SettingRow
                title={tr("Disconnect this device")}
                hint={tr("Forget this computer on the phone only.")}
                danger
                disabled={busy}
                onPress={() =>
                  setConfirm({
                    title: tr("Disconnect from {name}?", { name: host.name }),
                    text: tr(
                      "The saved connection is removed from this phone. The computer keeps this phone in its paired list until you revoke it.",
                    ),
                    action: tr("Disconnect"),
                    danger: true,
                    run: disconnect,
                  })
                }
              />
              <SettingRow
                title={tr("Revoke this phone's access")}
                hint={tr("Signs this phone out on the computer too.")}
                danger
                disabled={locked || !thisDevice}
                last
                onPress={() =>
                  thisDevice && setConfirm({
                    title: tr("Revoke this phone's access?"),
                    text: tr(
                      "This phone is signed out of {name} right away and has to be paired again to reconnect.",
                      { name: host.name },
                    ),
                    action: tr("Revoke access"),
                    danger: true,
                    run: async () => {
                      await client.revokeDevice(thisDevice.id);
                      await disconnect();
                    },
                  })
                }
              />
            </Section>
            <Section
              title={otherDevices.length ? tr("Other paired devices ({count})", { count: otherDevices.length }) : tr("Other paired devices")}
              footer={tr(
                "Revoking signs a device out right away; it has to be paired again to reconnect. To pair another device, generate pairing data with Dabots Bridge on your computer.",
              )}
            >
              {otherDevices.map((device) => {
                const stale = isStale(device, now);
                return (
                  <SettingRow
                    key={device.id}
                    title={deviceName(device)}
                    hint={[
                      tr("Paired {when}", { when: when(device.createdAt) }),
                      stale ? tr("Signed out, not used for 30 days") : tr("Active {when}", { when: when(device.lastSeenAt) }),
                    ].join(" · ")}
                  >
                    <Button
                      title={tr("Revoke")}
                      danger
                      secondary
                      compact
                      disabled={locked}
                      onPress={() =>
                        setConfirm({
                          title: tr("Revoke {name}?", { name: deviceName(device) }),
                          text: tr(
                            "That device is signed out of {host} right away and has to be paired again to reconnect. Paired {paired}.",
                            { host: host.name, paired: when(device.createdAt) },
                          ),
                          action: tr("Revoke access"),
                          danger: true,
                          run: loadAfter(() => client.revokeDevice(device.id)),
                        })
                      }
                    />
                  </SettingRow>
                );
              })}
              {!otherDevices.length && <SettingRow title={tr("No other devices")} hint={tr("Only this phone is paired with this computer.")} />}
              <SettingRow
                title={tr("Refresh devices")}
                onPress={loadDevices}
                disabled={!online || busy}
                last
              />
            </Section>
            <Text style={{ fontSize: 13, lineHeight: 18, color: t.muted, paddingHorizontal: 20 }}>
              {tr(
                "History and drafts are stored separately for this server. Credentials use {storage}.",
                {
                  storage:
                    Platform.OS === "web"
                      ? tr("this browser tab’s memory")
                      : tr("the system secure store"),
                },
              )}
            </Text>
            {Platform.OS === "web" && (
              <Notice
                text={tr(
                  "Development preview. Native camera, microphone, secure storage, and background behavior require iOS and Android device verification.",
                )}
              />
            )}
          </>
        )}
        {activePage === "about" && <AboutPanel client={client} team={team} online={online} refresh={refresh}/>}
        {activePage === "updates" && <PluginUpdateCard client={client} team={team} online={online} refresh={refresh}/>}
        {activePage === "schedules" && (
          <SchedulesPanel client={client} team={team} online={online} />
        )}
        {activePage === "usage" && (
          <UsagePanel client={client} team={team} online={online} />
        )}
        {(
          ["connectors", "secrets", "feedback", "harness"] as SettingsPage[]
        ).includes(activePage as SettingsPage) && (
          <HostSettingsPanel
            client={client}
            team={team}
            online={online}
            refresh={refresh}
            page={page as "connectors" | "secrets" | "feedback" | "harness"}
          />
        )}
      </ScrollView>
      </Transition>
      <EdgeFade edge="top" height={84} />
      <Sheet title={tr("My avatar")} visible={editingLook} onClose={() => setEditingLook(false)}>
        <MyLookPersistence />
        <AvatarEditor bot={meAsBot(myLook, tr("Me"))} onChange={updateMyLook} onReset={resetMyLook} />
      </Sheet>
      <Sheet
        title={confirm?.title || tr("Confirm")}
        visible={!!confirm}
        onClose={() => setConfirm(null)}
      >
        <Label>{confirm?.text}</Label>
        <Button
          title={confirm?.action || tr("Confirm")}
          danger={confirm?.danger}
          disabled={busy}
          onPress={() =>
            perform(async () => {
              await confirm?.run();
              setConfirm(null);
            })
          }
        />
        <Button title={tr("Cancel")} secondary disabled={busy} onPress={() => setConfirm(null)} />
      </Sheet>
    </View>
  );
}

/** Whether the open computer is reachable, as a coloured dot and a word. */
function ConnectionState({ online, compact = false }: { online: boolean; compact?: boolean }) {
  const t = useTheme();
  const color = online ? t.success : t.faint;
  return <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
    <Text numberOfLines={1} style={{ color: online ? t.success : t.muted, fontSize: compact ? 13 : 14, fontWeight: "500" }}>{tr(online ? "Connected" : "Offline")}</Text>
  </View>;
}
