// DS Bot Mobile: the home's DSH Agent view. The computer's Agent conversations, newest first,
// under a prominent "New Agent" action; or, when the owner has not allowed this phone, how to.
import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import SquareTerminalIcon from "lucide-react-native/icons/square-terminal";
import PlusIcon from "lucide-react-native/icons/plus";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { useDsText } from "@ds/text";
import type { DsConversationView } from "@ds/contracts";

const time = (value: unknown) => {
  const at = typeof value === "number" ? value : typeof value === "string" ? Date.parse(value) : 0;
  return Number.isFinite(at) && at > 0 ? at : 0;
};

export function AgentListView({ agents, canCreate, creating, error, header, topInset, bottomInset, sideInsets, onOpen, onCreate }: {
  agents: readonly DsConversationView[];
  canCreate: boolean;
  creating: boolean;
  error: string;
  header?: ReactNode;
  topInset: number;
  bottomInset: number;
  sideInsets: { left: number; right: number };
  onOpen: (agent: DsConversationView) => void;
  onCreate: () => void;
}) {
  const { tr } = useDsText();
  const [accent, muted, separator] = useThemeColor(["accent", "muted", "separator"]);
  const sorted = [...agents].sort((a, b) => time(b.source.updatedAt) - time(a.source.updatedAt));
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset, paddingLeft: sideInsets.left, paddingRight: sideInsets.right, gap: 14 }}>
      {header}
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <View style={{ paddingHorizontal: 4, gap: 2 }}>
          <Typography.Heading className="font-bold" style={{ fontSize: 22, lineHeight: 28 }}>{tr("DSH Agent")}</Typography.Heading>
          <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18 }}>{tr("Classic Agent conversations on this computer, separate from the Bot team.")}</Typography.Paragraph>
        </View>
        {canCreate
          ? <Button size="lg" isDisabled={creating} onPress={() => { void haptics.impact("soft"); onCreate(); }}>
              <PlusIcon size={18} color="#ffffff" strokeWidth={2.4} />
              <Button.Label>{tr(creating ? "Creating Agent…" : "New DSH Agent")}</Button.Label>
            </Button>
          : <View className="rounded-2xl bg-control px-4 py-3">
              <Typography.Paragraph className="text-text-secondary" style={{ fontSize: 13, lineHeight: 19 }}>
                {tr("Allow this phone to use the DSH Agent on the computer first, under the paired devices of Dabots.")}
              </Typography.Paragraph>
            </View>}
        {error ? <Typography.Paragraph accessibilityRole="alert" className="text-danger-text" style={{ fontSize: 13, lineHeight: 18 }}>{tr(error)}</Typography.Paragraph> : null}
      </View>
      <View>
        {sorted.map((agent, index) => (
          <Pressable key={agent.id} accessibilityRole="button" accessibilityLabel={agent.name} onPress={() => { void haptics.impact("soft"); onOpen(agent); }}
            style={({ pressed }) => ({ opacity: pressed ? 0.58 : 1 })}>
            <View className="flex-row items-center gap-3" style={{ minHeight: 64, paddingHorizontal: 16, paddingVertical: 10 }}>
              <View className="items-center justify-center rounded-2xl" style={{ width: 44, height: 44, backgroundColor: `${String(accent)}22` }}>
                <SquareTerminalIcon size={22} color={String(accent)} strokeWidth={2} />
              </View>
              <View className="min-w-0 flex-1 gap-0.5">
                <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{agent.name}</Typography.Paragraph>
                <Typography.Paragraph className="text-muted" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>{formatUpdatedAt(time(agent.source.updatedAt) ? new Date(time(agent.source.updatedAt)).toISOString() : null) || tr("DSH Agent")}</Typography.Paragraph>
              </View>
            </View>
            {index < sorted.length - 1 ? <View style={{ height: StyleSheet.hairlineWidth, marginLeft: 16 + 44 + 12, backgroundColor: String(separator) }} /> : null}
          </Pressable>
        ))}
        {!sorted.length ? <Typography.Paragraph className="text-muted" align="center" style={{ paddingTop: 24, color: String(muted) }}>{tr("No Agent conversations yet.")}</Typography.Paragraph> : null}
      </View>
    </ScrollView>
  );
}
