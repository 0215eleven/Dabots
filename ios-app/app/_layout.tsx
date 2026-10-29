import "../global.css";
import "react-native-reanimated";
import React from "react";
import {DsProvider} from "../src/ds/provider";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
const queryClient = new QueryClient();
import { LogBox, View } from "react-native";
import { designPreview } from "../src/preview/preview-session";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { HeroUINativeProvider } from "heroui-native/provider";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MotionProvider } from "../src/components/Motion";
import { LocaleBridge } from "../src/openbot/locale-bridge";
import { SessionProvider } from "../src/session/SessionProvider";
import { useTheme } from "../src/theme";

// Screenshots of the design preview should show the screens, not development warnings.
if (designPreview) LogBox.ignoreAllLogs(true);

function Root() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" options={{ headerTransparent: true, headerShadowVisible: false, title: "" }} />
        <Stack.Screen name="settings" options={{ headerTransparent: true, headerShadowVisible: false, title: "", headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="chat/[agentId]" options={{ headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="add-agent" options={{title:"Add Bot",presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="add-channel" options={{title:"New group",presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="agent-info/[agentId]" options={{title:"Bot",presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="channel-info/[channelId]" options={{title:"Group",presentation:"formSheet",sheetAllowedDetents:[0.85],sheetGrabberVisible:true,sheetExpandsWhenScrolledToEdge:false}} />
        <Stack.Screen name="+not-found" options={{title:"Unavailable"}} />
        <Stack.Screen name="pairing" options={{ presentation: "modal", headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="classic" options={{ headerShown: false }} />
      </Stack>
    </View>
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
                <QueryClientProvider client={queryClient}><DsProvider><LocaleBridge /><Root /></DsProvider></QueryClientProvider>
              </SessionProvider>
            </MotionProvider>
          </HeroUINativeProvider>
        </KeyboardProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
