import React from "react";
import { Stack, useLocalSearchParams } from "expo-router";
import type { Route } from "../src/logic/app-navigation";
import ClassicApp from "../src/App";

// The previous single-page shell, kept for team and host management until those screens move over.
function parse(value: string | undefined): Route | undefined {
  if (!value) return undefined;
  try {
    const route = JSON.parse(value) as Route;
    return route && typeof route === "object" && typeof route.page === "string" ? route : undefined;
  } catch { return undefined; }
}

export default function Classic() {
  const { open } = useLocalSearchParams<{ open?: string }>();
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <ClassicApp initial={parse(open)} />
    </>
  );
}
