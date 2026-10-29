import React from "react";
import { Stack } from "expo-router";
import { useTheme } from "../../../src/theme";

export default function Layout() {
  const t = useTheme();
  return <Stack screenOptions={{ headerLargeTitle: true, headerTransparent: true, headerBlurEffect: "none", headerLargeTitleShadowVisible: false, contentStyle: { backgroundColor: t.bg }, headerTintColor: t.accent }} />;
}
