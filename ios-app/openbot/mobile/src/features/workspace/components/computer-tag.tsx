// DS Bot Mobile: names the computer of a chat row while the home list shows every computer.
import { Typography } from "heroui-native";
import { createContext, useContext } from "react";
import { StyleSheet, View } from "react-native";

/** Computer names by server id, or null when the list shows a single computer. */
export const ComputerTagContext = createContext<ReadonlyMap<string, string> | null>(null);

export function ComputerTag({ serverId }: { serverId?: string }) {
  const name = useContext(ComputerTagContext)?.get(serverId ?? "");
  if (!name) return null;
  return (
    <View className="rounded-md bg-control px-1.5" style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: "rgba(127,127,127,0.25)" }}>
      <Typography.Paragraph className="text-muted" numberOfLines={1} style={{ fontSize: 11, lineHeight: 16 }}>
        {name}
      </Typography.Paragraph>
    </View>
  );
}
