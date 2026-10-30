import "../global.css";
import "react-native-reanimated";
import React, { useLayoutEffect, useMemo } from "react";
import {useI18n} from "../src/i18n";
import {DsProvider} from "../src/ds/provider";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
const queryClient = new QueryClient();
import { LogBox, Platform, View } from "react-native";
import { designPreview } from "../src/preview/preview-session";
import { Stack } from "expo-router";
import { DarkTheme, DefaultTheme, ThemeProvider } from "expo-router/react-navigation";
import * as SystemUI from "expo-system-ui";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import { useCSSVariable } from "uniwind";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MotionProvider } from "../src/components/Motion";
import { LocaleBridge } from "../src/openbot/locale-bridge";
import { SessionProvider } from "../src/session/SessionProvider";
import { ComputerNamesProvider } from "../src/names/ComputerNamesProvider";
import { PeerHostsProvider } from "../src/session/PeerHostsProvider";
import { useTheme } from "../src/theme";

// Screenshots of the design preview should show the screens, not development warnings.
if (designPreview) LogBox.ignoreAllLogs(true);

function Root() {
  const t = useTheme();
  const sheetBackground = useCSSVariable("--openbot-bg-sheet");
  const {tr} = useI18n();
  const navigationTheme = useMemo(() => {
    const base = t.dark ? DarkTheme : DefaultTheme;
    return { ...base, colors: { ...base.colors, background: t.bg, card: t.bg, text: t.ink, primary: t.accent, border: t.line } };
  }, [t.dark, t.bg, t.ink, t.accent, t.line]);
  useLayoutEffect(() => {
    // Screen content does not cover the window during native bounce/modal transitions.
    // Expo updates both the iOS UIWindow and root controller (and the web body).
    void SystemUI.setBackgroundColorAsync(t.bg).catch(() => {
      if (__DEV__) console.warn("Could not update the system background.");
    });
    if (Platform.OS === "web" && typeof document !== "undefined") {
      document.documentElement.style.backgroundColor = t.bg;
      document.documentElement.style.colorScheme = t.dark ? "dark" : "light";
    }
  }, [t.bg, t.dark]);
  return (
    <ThemeProvider value={navigationTheme}>
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="connected" options={{ headerShown: false }} />
        <Stack.Screen name="settings" options={{ headerShown: false, presentation: "formSheet", sheetAllowedDetents: [0.85], sheetGrabberVisible: true, sheetExpandsWhenScrolledToEdge: false, gestureEnabled: true, contentStyle: { backgroundColor: String(sheetBackground) } }} />
        <Stack.Screen name="chat/[agentId]" options={{ headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="add-agent" options={{title:tr("Add Bot"),presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="add-channel" options={{title:tr("New group"),presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="agent-info/[agentId]" options={{title:tr("Bot"),presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="channel-info/[channelId]" options={{title:tr("Group"),presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="+not-found" options={{title:tr("Unavailable")}} />
        <Stack.Screen name="pairing" options={{ presentation: "modal", headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="computer-name" options={{ title: tr("Computer name"), presentation: "formSheet", sheetAllowedDetents: [0.85], sheetGrabberVisible: true, sheetExpandsWhenScrolledToEdge: false }} />
        <Stack.Screen name="classic" options={{ headerShown: false }} />
      </Stack>
    </View>
    </ThemeProvider>
  );
}

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProvider>
          <HeroUINativeProvider>
            <MotionProvider>
              <SessionProvider>
                <ComputerNamesProvider><PeerHostsProvider><QueryClientProvider client={queryClient}><DsProvider><LocaleBridge /><Root /></DsProvider></QueryClientProvider></PeerHostsProvider></ComputerNamesProvider>
              </SessionProvider>
            </MotionProvider>
          </HeroUINativeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
