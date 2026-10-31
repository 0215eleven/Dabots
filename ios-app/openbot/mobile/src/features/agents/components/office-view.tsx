// DS Bot Mobile: the home's office mode. Every Bot has a desk and shows what it is doing there;
// group chats are meeting rooms, and a Bot in a running meeting sits at that room's table instead
// of its desk. Tapping a desk or a room opens that chat.
import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo, useEffect, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import { BloubAvatar } from "@/features/agents/components/bloub-avatar";
import type { MobileAgent } from "@/features/workspace/context/mobile-workspace-context";
import { haptics } from "@/shared/lib/haptics";
import { useReducedMotion } from "@/shared/lib/motion";
import { useDsText } from "@ds/text";
import type { DsWorkView } from "@ds/contracts";

type Phase = DsWorkView["phase"];
const busy = (phase: Phase | undefined) => phase === "working" || phase === "responding";

/** Where each Bot is: at its desk, or at the table of the meeting it is working in. */
export function officeSeats(agents: readonly MobileAgent[], rooms: readonly ChannelSummary[], work: Readonly<Record<string, DsWorkView>>) {
  const inMeeting = new Map<string, ChannelSummary>();
  for (const room of rooms) {
    if (work[room.id]?.phase === "idle" || !work[room.id]) continue;
    for (const member of work[room.id].members ?? []) if (member.phase !== "idle") inMeeting.set(member.botId, room);
  }
  return { inMeeting, busyDesks: agents.filter(agent => !inMeeting.has(agent.id) && busy(work[agent.id]?.phase)).length,
    meetings: rooms.filter(room => work[room.id] && work[room.id].phase !== "idle").length };
}

/** The desk monitor: its screen glows while the Bot works, turns amber while it waits for you. */
function Monitor({ phase }: { phase: Phase | undefined }) {
  const [success, warning, muted, line] = useThemeColor(["success", "warning", "muted", "separator"]);
  const reducedMotion = useReducedMotion();
  const glow = useSharedValue(1);
  const working = busy(phase);
  useEffect(() => {
    if (!working || reducedMotion) { cancelAnimation(glow); glow.set(1); return; }
    glow.set(withRepeat(withTiming(0.45, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(glow);
  }, [working, reducedMotion, glow]);
  const screen = useAnimatedStyle(() => ({ opacity: glow.get() }));
  const color = working ? String(success) : phase === "waiting" ? String(warning) : String(muted);
  return (
    <View accessible={false} style={{ alignItems: "center" }}>
      <View style={{ width: 30, height: 21, borderRadius: 5, borderWidth: 2, borderColor: String(line), padding: 2 }}>
        <Animated.View style={[{ flex: 1, borderRadius: 2, backgroundColor: color, opacity: working || phase === "waiting" ? 1 : 0.25 }, working ? screen : null]} />
      </View>
      <View style={{ width: 4, height: 4, backgroundColor: String(line) }} />
      <View style={{ width: 14, height: 2, borderRadius: 1, backgroundColor: String(line) }} />
    </View>
  );
}

function StatusLine({ phase, detail, meeting }: { phase: Phase | undefined; detail: string | null | undefined; meeting?: string }) {
  const { tr } = useDsText();
  const [success, warning] = useThemeColor(["success", "warning"]);
  const label = meeting ? tr("In meeting room · {name}", { name: meeting })
    : phase === "waiting" ? tr("Waiting for you")
      : busy(phase) ? [tr("Working"), detail].filter(Boolean).join(" · ") : tr("Free");
  const color = meeting || busy(phase) ? String(success) : phase === "waiting" ? String(warning) : undefined;
  return <Typography.Paragraph className={color ? undefined : "text-muted"} numberOfLines={2} style={{ fontSize: 12.5, lineHeight: 16, ...(color ? { color } : {}) }}>{label}</Typography.Paragraph>;
}

const Desk = memo(function Desk({ agent, phase, detail, meeting, onOpen }: { agent: MobileAgent; phase: Phase | undefined; detail: string | null | undefined; meeting?: string; onOpen: (agent: MobileAgent) => void }) {
  const [line] = useThemeColor(["separator"]);
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={agent.name} onPress={() => { void haptics.impact("soft"); onOpen(agent); }}
      className="rounded-[20px] bg-control" style={({ pressed }) => ({ flex: 1, padding: 12, gap: 8, opacity: pressed ? 0.6 : 1, borderCurve: "continuous" })}>
      <View className="flex-row items-end justify-between">
        {/* An empty chair while the Bot is away in a meeting. */}
        <View style={{ opacity: meeting ? 0.28 : 1 }}>
          <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={50} animateIdle={false} rings />
        </View>
        <Monitor phase={meeting ? "idle" : phase} />
      </View>
      <View style={{ height: 5, borderRadius: 3, backgroundColor: String(line) }} />
      <View style={{ gap: 2 }}>
        <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 15, lineHeight: 20 }}>{agent.name}</Typography.Paragraph>
        <StatusLine phase={phase} detail={detail} meeting={meeting} />
      </View>
    </Pressable>
  );
});

const Room = memo(function Room({ room, work, agents, onOpen }: { room: ChannelSummary; work: DsWorkView | undefined; agents: ReadonlyMap<string, MobileAgent>; onOpen: (room: ChannelSummary) => void }) {
  const { tr } = useDsText();
  const [success, warning, background, line] = useThemeColor(["success", "warning", "background", "separator"]);
  const live = work && work.phase !== "idle";
  const members = room.members.map(member => agents.get(member.agentId)).filter((agent): agent is MobileAgent => !!agent).slice(0, 8);
  const top = members.filter((_, index) => index % 2 === 0), bottom = members.filter((_, index) => index % 2 === 1);
  const seat = (agent: MobileAgent) => {
    const speaking = work?.members?.find(member => member.botId === agent.id)?.phase;
    return <View key={agent.id} style={{ opacity: !live || busy(speaking) || speaking === "waiting" ? 1 : 0.55 }}>
      <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={36} animateIdle={false} rings />
    </View>;
  };
  const status = work?.phase === "waiting" ? { text: tr("Waiting for you"), color: String(warning) } : live ? { text: tr("In a meeting"), color: String(success) } : null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={room.name} onPress={() => { void haptics.impact("soft"); onOpen(room); }}
      className="rounded-[22px] bg-control" style={({ pressed }) => ({ padding: 14, gap: 10, opacity: pressed ? 0.6 : 1, borderCurve: "continuous", borderWidth: live ? 1.5 : 0, borderColor: status?.color })}>
      <View className="flex-row items-center gap-2">
        <Typography.Paragraph className="font-semibold min-w-0 flex-1" numberOfLines={1} style={{ fontSize: 16, lineHeight: 21 }}>{room.name}</Typography.Paragraph>
        {status
          ? <View className="flex-row items-center gap-1.5 rounded-full px-2.5" style={{ height: 24, backgroundColor: `${status.color}22` }}>
              <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: status.color }} />
              <Typography.Paragraph style={{ fontSize: 12, lineHeight: 16, fontWeight: "600", color: status.color }}>{status.text}</Typography.Paragraph>
            </View>
          : <Typography.Paragraph className="text-muted" style={{ fontSize: 12, lineHeight: 16 }}>{tr("Free")}</Typography.Paragraph>}
      </View>
      {/* The table, with the members seated along both sides. */}
      <View style={{ gap: 4, alignItems: "center" }}>
        <View className="flex-row" style={{ gap: 14 }}>{top.map(seat)}</View>
        <View style={{ alignSelf: "stretch", height: 26, borderRadius: 13, backgroundColor: String(background), borderWidth: StyleSheet.hairlineWidth, borderColor: String(line), marginHorizontal: 18 }} />
        <View className="flex-row" style={{ gap: 14 }}>{bottom.map(seat)}</View>
      </View>
      {room.lastMessage?.text
        ? <Typography.Paragraph className="text-text-secondary" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>{room.lastMessage.text}</Typography.Paragraph>
        : null}
    </Pressable>
  );
});

function Section({ title, detail, children }: { title: string; detail?: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View className="flex-row items-baseline gap-2" style={{ paddingHorizontal: 4 }}>
        <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{title}</Typography.Paragraph>
        {detail ? <Typography.Paragraph className="text-muted" style={{ fontSize: 12, lineHeight: 16 }}>{detail}</Typography.Paragraph> : null}
      </View>
      {children}
    </View>
  );
}

export function OfficeView({ agents, rooms, work, header, topInset, bottomInset, sideInsets, onOpenBot, onOpenRoom }: {
  agents: readonly MobileAgent[];
  rooms: readonly ChannelSummary[];
  work: Readonly<Record<string, DsWorkView>>;
  header?: ReactNode;
  topInset: number;
  bottomInset: number;
  sideInsets: { left: number; right: number };
  onOpenBot: (agent: MobileAgent) => void;
  onOpenRoom: (room: ChannelSummary) => void;
}) {
  const { tr } = useDsText();
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const { inMeeting, busyDesks, meetings } = officeSeats(agents, rooms, work);
  const rows: MobileAgent[][] = [];
  for (let index = 0; index < agents.length; index += 2) rows.push(agents.slice(index, index + 2));
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset, paddingLeft: sideInsets.left, paddingRight: sideInsets.right, gap: 18 }}>
      {header}
      <View style={{ paddingHorizontal: 16, gap: 22 }}>
        {rooms.length ? (
          <Section title={tr("Meeting rooms")} detail={meetings ? tr("{count} in a meeting", { count: String(meetings) }) : undefined}>
            {rooms.map(room => <Room key={room.id} room={room} work={work[room.id]} agents={byId} onOpen={onOpenRoom} />)}
          </Section>
        ) : null}
        <Section title={tr("Desks")} detail={busyDesks ? tr("{count} working", { count: String(busyDesks) }) : undefined}>
          {rows.map(row => (
            <View key={row.map(agent => agent.id).join()} className="flex-row" style={{ gap: 10 }}>
              {row.map(agent => <Desk key={agent.id} agent={agent} phase={work[agent.id]?.phase} detail={work[agent.id]?.detail} meeting={inMeeting.get(agent.id)?.name} onOpen={onOpenBot} />)}
              {row.length === 1 ? <View style={{ flex: 1 }} /> : null}
            </View>
          ))}
        </Section>
      </View>
    </ScrollView>
  );
}
