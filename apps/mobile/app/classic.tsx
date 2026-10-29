import React from "react";
import { Stack } from "expo-router";
import ClassicApp from "../src/App";

// The previous single-page shell, kept for team and host management until those screens move over.
export default function Classic() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: true }} />
      <ClassicApp />
    </>
  );
}
