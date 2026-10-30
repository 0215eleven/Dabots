// DS Bot Mobile: a chat of another paired computer in the home list's "All" view. It looks like the
// list's own rows; opening it switches the session to that computer first.
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo } from "react";
import { Pressable, View } from "react-native";
import { BloubAvatarPreview } from "@/features/agents/components/bloub-avatar";
import { ComputerTag } from "@/features/workspace/components/computer-tag";
import { formatUpdatedAt } from "@/shared/lib/format-updated-at";
import { haptics } from "@/shared/lib/haptics";
import { typeScale } from "@/shared/lib/type-scale";
import { useDsText } from "@ds/text";
import type { PeerRow } from "@ds/computers";

const MINI = 22;
const MINI_SPOTS = [{ left: 2, top: 4 }, { left: 24, top: 6 }, { left: 13, top: 24 }];

function PeerAvatar({ row, disconnected }: { row: PeerRow; disconnected: boolean }) {
  if (row.kind === "bot" || !row.avatar.members.length)
    return <BloubAvatarPreview hue={null} color={row.avatar.color} seed={row.avatar.seed} size={48} animateIdle={false} disconnected={disconnected} />;
  return (
    <View style={{ width: 48, height: 48 }}>
      {row.avatar.members.map((member, index) => (
        <View key={index} style={{ position: "absolute", ...MINI_SPOTS[index] }}>
          <BloubAvatarPreview hue={null} color={member.color} seed={member.seed} size={MINI} animateIdle={false} disconnected={disconnected} />
        </View>
      ))}
    </View>
  );
}

export const PeerChatRow = memo(function PeerChatRow({ row, online, onOpen }: { row: PeerRow; online: boolean; onOpen: (row: PeerRow) => void }) {
  const { tr } = useDsText();
  const [background] = useThemeColor(["background"]);
  const preview = row.preview || row.title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.name}
      onPress={() => { void haptics.impact("soft"); onOpen(row); }}
    >
      {({ pressed }) => (
        <View
          className="w-full flex-row items-center gap-3"
          style={{ backgroundColor: background, opacity: pressed ? 0.58 : online ? 1 : 0.55, minHeight: 72, paddingVertical: 10, paddingLeft: 16, paddingRight: 16 }}
        >
          <PeerAvatar row={row} disconnected={!online} />
          <View className="min-w-0 flex-1 gap-0.5">
            <View className="flex-row items-center gap-2">
              <Typography.Paragraph className="font-semibold min-w-0 flex-1" numberOfLines={1} style={typeScale.rowTitle}>{row.name}</Typography.Paragraph>
              <Typography.Paragraph className="text-muted" style={typeScale.small}>{row.at ? formatUpdatedAt(new Date(row.at).toISOString()) : ""}</Typography.Paragraph>
            </View>
            <View className="flex-row items-center gap-2">
              <Typography.Paragraph className="text-text-secondary min-w-0 flex-1" numberOfLines={1} style={typeScale.preview}>
                {online ? preview : [tr("Computer offline"), preview].filter(Boolean).join(" · ")}
              </Typography.Paragraph>
              <ComputerTag serverId={row.serverId} />
            </View>
          </View>
        </View>
      )}
    </Pressable>
  );
});
