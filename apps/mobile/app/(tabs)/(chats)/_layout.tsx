import React from "react";
import { Stack } from "expo-router";
import { tr } from "../../../src/i18n";
import { selectionFeedback } from "../../../src/media/haptics";
import { useSession } from "../../../src/session/SessionProvider";

export default function Layout() {
  const { resume } = useSession();
  return (
    <Stack screenOptions={{ headerTransparent: true, headerShadowVisible: false, title: "" }}>
      <Stack.Screen name="index">
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu icon="ellipsis.circle" title={tr("More")}>
            <Stack.Toolbar.MenuAction icon="arrow.clockwise" onPress={() => { selectionFeedback(); resume(); }}>{tr("Reconnect now")}</Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      </Stack.Screen>
    </Stack>
  );
}
