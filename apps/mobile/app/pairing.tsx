import React from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PairingScreen } from "../src/screens/PairingScreen";
import { useSession } from "../src/session/SessionProvider";
import { useTheme } from "../src/theme";

export default function Pairing() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const session = useSession();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: insets.top }}>
      <PairingScreen
        slot={session.pairingSlot}
        onConnected={async (host, client) => { await session.connected(host, client); router.replace("/"); }}
        onCancel={session.host ? () => router.back() : undefined}
      />
    </View>
  );
}
