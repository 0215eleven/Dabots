import React from "react";
import { Stack } from "expo-router";

export default function Layout() {
  return <Stack screenOptions={{ headerTransparent: true, headerShadowVisible: false, title: "" }} />;
}
