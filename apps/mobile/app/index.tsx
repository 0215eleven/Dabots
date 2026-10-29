import React from "react";
import { Redirect, Stack } from "expo-router";
import { tr } from "../src/i18n";
import { selectionFeedback } from "../src/media/haptics";
import { AppDrawerShell, useAppDrawer } from "../src/openbot/features/servers/components/app-drawer-shell";
import { OpenBotHome } from "../src/openbot/home-screen";
import { useSession } from "../src/session/SessionProvider";

function Home() {
  const { resume } = useSession();
  const drawer = useAppDrawer();
  return (
    <>
      <Stack.Toolbar placement="left">
        <Stack.Toolbar.Button icon="sidebar.left" accessibilityLabel={tr("Computers")} onPress={drawer.openDrawer} />
      </Stack.Toolbar>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button icon="arrow.clockwise" accessibilityLabel={tr("Reconnect now")} onPress={() => { selectionFeedback(); resume(); }} />
      </Stack.Toolbar>
      <OpenBotHome />
    </>
  );
}

// Home sits in OpenBot's drawer shell: swipe right (or the sidebar button) for computers, team pages and settings.
export default function Index() {
  const { loading, host } = useSession();
  if (!loading && !host) return <Redirect href="/pairing" />;
  return (
    <AppDrawerShell>
      <Home />
    </AppDrawerShell>
  );
}
