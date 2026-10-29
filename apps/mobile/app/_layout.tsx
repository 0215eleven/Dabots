import "react-native-reanimated";
import React from "react";
import { View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MotionProvider } from "../src/components/Motion";
import { SessionProvider } from "../src/session/SessionProvider";
import { useTheme } from "../src/theme";

function Root() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? "light" : "dark"} />
      <Stack screenOptions={{ contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerBackButtonDisplayMode: "minimal" }} />
        <Stack.Screen name="pairing" options={{ presentation: "modal", headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="classic" options={{ headerShown: false }} />
      </Stack>
    </View>
  );
}

export default function Layout() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <MotionProvider>
          <SessionProvider>
            <Root />
          </SessionProvider>
        </MotionProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
