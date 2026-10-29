import React, { useEffect, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { Typography } from "heroui-native";
import { Host as UiHost, Picker, Switch } from "@expo/ui";
import Constants from "expo-constants";
import { Stack, useRouter } from "expo-router";
import { LargeTitleScrollView } from "../src/openbot/shared/components/large-title";
import { hostAddress } from "../src/logic/hosts";
import { setLiveActivityEnabled } from "../src/liveactivity/controller";
import { LocalePreference, setLocalePreference, useI18n } from "../src/i18n";
import { errorFeedback, selectionFeedback, successFeedback } from "../src/media/haptics";
import { useSession } from "../src/session/SessionProvider";
import { readCache, writeCache } from "../src/storage";
import { ColorMode, setColorMode, useColorMode } from "../src/theme";
import { errorText } from "../src/types";

function Group({ title, footer, children }: { title: string; footer?: string; children: React.ReactNode }) {
  return (
    <View className="gap-1.5">
      <Typography.Paragraph className="text-muted px-4 uppercase" style={{ fontSize: 13 }}>{title}</Typography.Paragraph>
      <View className="overflow-hidden bg-grouped" style={{ borderRadius: 16, borderCurve: "continuous" }}>{children}</View>
      {footer ? <Typography.Paragraph className="text-muted px-4" style={{ fontSize: 12 }}>{footer}</Typography.Paragraph> : null}
    </View>
  );
}
function Row({ title, detail, onPress, destructive, children }: { title: string; detail?: string; onPress?(): void; destructive?: boolean; children?: React.ReactNode }) {
  const content = (
    <View className="min-h-12 flex-row items-center gap-3 px-4 py-2.5">
      <View className="flex-1">
        <Typography.Paragraph className={destructive ? "text-danger-text" : onPress ? "text-accent-text" : ""} style={{ fontSize: 16 }}>{title}</Typography.Paragraph>
        {detail ? <Typography.Paragraph className="text-muted" numberOfLines={2} style={{ fontSize: 13, marginTop: 2 }}>{detail}</Typography.Paragraph> : null}
      </View>
      {children}
    </View>
  );
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>{content}</Pressable> : content;
}

export default function Settings() {
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
    <LargeTitleScrollView title={tr("Settings")} caption={host?.name} contentContainerClassName="gap-6 px-4 pt-3">
      <Stack.Screen options={{ title: "", headerTransparent: true, headerShadowVisible: false }} />
      {message || session.error ? <Typography.Paragraph className="text-danger-text px-1">{message || session.error}</Typography.Paragraph> : null}
      <Group title={tr("Connection")} footer={tr("The app keeps one WebSocket per open chat and resumes from where it stopped after a network change or when it returns from the background.")}>
        <Row title={host?.name || tr("No computer paired")} detail={host ? hostAddress(host) : undefined}>
          <Typography.Paragraph className={session.workspace.online ? "text-success-text" : "text-muted"} style={{ fontSize: 14 }}>{status}</Typography.Paragraph>
        </Row>
        <Row title={tr("Reconnect now")} onPress={host ? () => { successFeedback(); session.resume(); } : undefined} />
      </Group>

      <Group title={tr("Computers")}>
        {session.hosts.map(item => (
          <Row key={item.slot || item.serverId} title={item.name} detail={hostAddress(item)} onPress={host && item.serverId === host.serverId ? undefined : () => { selectionFeedback(); void session.switchHost(item); }}>
            {host && item.serverId === host.serverId ? <Typography.Paragraph className="text-accent-text" style={{ fontSize: 14 }}>{tr("Selected")}</Typography.Paragraph>
              : <Pressable accessibilityRole="button" accessibilityLabel={tr("Forget {p0}?", { p0: item.name })} onPress={() => forget(item)} hitSlop={10}><Typography.Paragraph className="text-danger-text" style={{ fontSize: 14 }}>{tr("Forget")}</Typography.Paragraph></Pressable>}
          </Row>
        ))}
        <Row title={tr("Pair a computer")} onPress={() => router.push("/pairing")} />
      </Group>

      {host ? (
        <Group title={tr("Mode")}>
          <Row
            title={tr("Classic Agent mode")}
            detail={session.agentsAvailable ? tr("Show DSH Agent conversations on the home screen.") : tr("Allow this phone to use the DSH Agent on the computer first, under the paired devices of Dbot pro.")}
          >
            <UiHost matchContents>
              <Switch
                value={session.agentMode}
                disabled={!session.agentsAvailable}
                onValueChange={value => { selectionFeedback(); void session.setAgentMode(value).catch(err => setMessage(errorText(err))); }}
              />
            </UiHost>
          </Row>
        </Group>
      ) : null}

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
      <Typography.Paragraph className="text-muted text-center" style={{ fontSize: 12 }}>Dbot pro {Constants.expoConfig?.version} · {locale}</Typography.Paragraph>
    </LargeTitleScrollView>
  );
}
