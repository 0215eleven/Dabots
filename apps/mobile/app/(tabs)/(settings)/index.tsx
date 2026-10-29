import React, { useEffect, useState } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { Host as UiHost, Picker, Switch } from "@expo/ui";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { AnimatedPressable as Pressable } from "../../../src/components/Motion";
import { hostAddress } from "../../../src/logic/hosts";
import { setLiveActivityEnabled } from "../../../src/liveactivity/controller";
import { LocalePreference, setLocalePreference, useI18n } from "../../../src/i18n";
import { errorFeedback, selectionFeedback, successFeedback } from "../../../src/media/haptics";
import { useSession } from "../../../src/session/SessionProvider";
import { readCache, writeCache } from "../../../src/storage";
import { ColorMode, setColorMode, useColorMode, useTheme } from "../../../src/theme";
import { errorText } from "../../../src/types";

function Group({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.muted, fontSize: 13, textTransform: "uppercase", paddingHorizontal: 16 }}>{title}</Text>
      <View style={{ backgroundColor: t.surface === t.bg ? t.sidebar : t.surface, borderRadius: 20, borderCurve: "continuous", overflow: "hidden" }}>{children}</View>
      {footer ? <Text style={{ color: t.faint, fontSize: 12, paddingHorizontal: 16 }}>{footer}</Text> : null}
    </View>
  );
}
function Row({ title, detail, onPress, destructive, children }: { title: string; detail?: string; onPress?(): void; destructive?: boolean; children?: React.ReactNode }) {
  const t = useTheme();
  const content = (
    <View style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 10, flexDirection: "row", alignItems: "center", gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: destructive ? t.error : onPress ? t.accent : t.ink, fontSize: 16 }}>{title}</Text>
        {detail ? <Text numberOfLines={2} style={{ color: t.muted, fontSize: 13, marginTop: 2 }}>{detail}</Text> : null}
      </View>
      {children}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress}>{content}</Pressable> : content;
}

export default function Settings() {
  const t = useTheme();
  const { tr, locale } = useI18n();
  const router = useRouter();
  const session = useSession();
  const mode = useColorMode();
  const [island, setIsland] = useState(true);
  const [language, setLanguage] = useState<LocalePreference>("host");
  const [message, setMessage] = useState("");
  const host = session.host;

  useEffect(() => {
    void readCache<boolean>("app", "liveActivity").then(value => { const on = value !== false; setIsland(on); setLiveActivityEnabled(on); }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!host) return;
    void readCache<{ locale?: LocalePreference }>(host.serverId, "mobile-preferences").then(value => setLanguage(value?.locale || "host")).catch(() => {});
  }, [host]);

  const status = !host ? tr("Not paired") : session.workspace.online ? tr("Connected") : tr("Connecting…");
  const changeMode = (value: ColorMode) => { selectionFeedback(); setColorMode(value); void writeCache("app", "colorMode", value); };
  const changeLanguage = async (value: LocalePreference) => {
    selectionFeedback();
    setLanguage(value);
    setLocalePreference(value);
    if (host) await writeCache(host.serverId, "mobile-preferences", { ...((await readCache<object>(host.serverId, "mobile-preferences")) || {}), locale: value });
  };
  const changeIsland = (value: boolean) => { selectionFeedback(); setIsland(value); setLiveActivityEnabled(value); void writeCache("app", "liveActivity", value); };
  const unpair = () => Alert.alert(tr("Unpair this computer?"), tr("Its chats are removed from this phone. Pair again to reconnect."), [
    { text: tr("Cancel"), style: "cancel" },
    { text: tr("Unpair"), style: "destructive", onPress: () => { errorFeedback(); session.disconnect().catch(err => setMessage(errorText(err))); } },
  ]);
  const forget = (target: (typeof session.hosts)[number]) => Alert.alert(tr("Forget {p0}?", { p0: target.name }), undefined, [
    { text: tr("Cancel"), style: "cancel" },
    { text: tr("Forget"), style: "destructive", onPress: () => void session.forgetHost(target).catch(err => setMessage(errorText(err))) },
  ]);

  return (
    <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: 16, gap: 24 }}>
      <Stack.Screen options={{ title: tr("Settings") }} />
      {message || session.error ? <Text style={{ color: t.error, paddingHorizontal: 4 }}>{message || session.error}</Text> : null}
      <Group title={tr("Connection")} footer={tr("The app keeps one WebSocket per open chat and resumes from where it stopped after a network change or when it returns from the background.")}>
        <Row title={host?.name || tr("No computer paired")} detail={host ? hostAddress(host) : undefined}>
          <Text style={{ color: session.workspace.online ? t.success : t.muted, fontSize: 14 }}>{status}</Text>
        </Row>
        <Row title={tr("Reconnect now")} onPress={host ? () => { successFeedback(); session.resume(); } : undefined} />
      </Group>

      <Group title={tr("Computers")}>
        {session.hosts.map(item => (
          <Row key={item.slot || item.serverId} title={item.name} detail={hostAddress(item)} onPress={host && item.serverId === host.serverId ? undefined : () => { selectionFeedback(); void session.switchHost(item); }}>
            {host && item.serverId === host.serverId ? <Text style={{ color: t.accent, fontSize: 14 }}>{tr("Selected")}</Text>
              : <Pressable accessibilityRole="button" accessibilityLabel={tr("Forget {p0}?", { p0: item.name })} onPress={() => forget(item)} hitSlop={10}><Text style={{ color: t.error, fontSize: 14 }}>{tr("Forget")}</Text></Pressable>}
          </Row>
        ))}
        <Row title={tr("Pair a computer")} onPress={() => router.push("/pairing")} />
      </Group>

      <Group title={tr("Appearance")}>
        <Row title={tr("Theme")}>
          <UiHost matchContents>
            <Picker selectedValue={mode} onValueChange={value => changeMode(value as ColorMode)} appearance="menu">
              <Picker.Item label={tr("System")} value="system" />
              <Picker.Item label={tr("Light")} value="light" />
              <Picker.Item label={tr("Dark")} value="dark" />
            </Picker>
          </UiHost>
        </Row>
        <Row title={tr("Language")}>
          <UiHost matchContents>
            <Picker selectedValue={language} onValueChange={value => void changeLanguage(value as LocalePreference)} appearance="menu">
              <Picker.Item label={tr("Follow computer")} value="host" />
              <Picker.Item label={tr("System")} value="system" />
              <Picker.Item label="English" value="en" />
              <Picker.Item label="中文" value="zh" />
            </Picker>
          </UiHost>
        </Row>
        {Platform.OS === "ios" ? (
          <Row title={tr("Dynamic Island")} detail={tr("Show what your Bots are doing on the Lock Screen and Dynamic Island while the app is open.")}>
            <UiHost matchContents><Switch value={island} onValueChange={changeIsland} /></UiHost>
          </Row>
        ) : null}
      </Group>

      <Group title={tr("More")}>
        <Row title={tr("Classic view")} detail={tr("Team, groups, schedules and host settings.")} onPress={() => router.push("/classic")} />
        {host ? <Row title={tr("Unpair this computer")} destructive onPress={unpair} /> : null}
      </Group>
      <Text style={{ color: t.faint, textAlign: "center", fontSize: 12 }}>DS Bot Mobile {Constants.expoConfig?.version} · {locale}</Text>
    </ScrollView>
  );
}
