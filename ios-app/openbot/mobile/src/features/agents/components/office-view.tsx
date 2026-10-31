// DS Bot Mobile: the home's office mode, drawn as isometric floors. Every Bot sits behind its own
// desk, whose monitor glows while it works and turns amber while it waits for you; group chats
// are glass meeting rooms in the back corner, and a Bot working in a running meeting sits at that
// room's table, leaving its desk chair empty. Tapping a desk or a room opens that chat.
import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo, useEffect, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Polygon } from "react-native-svg";
import { useUniwind } from "uniwind";
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

const DESKS_PER_FLOOR = 4;
/** One floor per four desks, and at least one floor per meeting room. */
export function officeFloors<T, R>(agents: readonly T[], rooms: readonly R[]) {
  const count = Math.max(1, Math.ceil(agents.length / DESKS_PER_FLOOR), rooms.length);
  return Array.from({ length: count }, (_, index) => ({ agents: agents.slice(index * DESKS_PER_FLOOR, (index + 1) * DESKS_PER_FLOOR), room: rooms[index] ?? null }));
}

// The floor plan, in floor tiles: a 6 × 6 room with walls on its two back sides, the meeting room
// in the back corner and four desks along the two open sides.
const SIZE = 6, ROOM = 2.7, WALL = 1.5, COS = Math.cos(Math.PI / 6);
const DESK_SLOTS = [{ x: 4.75, y: 1.1 }, { x: 4.75, y: 3.6 }, { x: 3.4, y: 4.85 }, { x: 0.9, y: 4.85 }];
const DESK = { w: 1.5, d: 0.8, h: 0.5 };

interface Palette { floorA: string; floorB: string; wallLeft: string; wallRight: string; window: string; top: string; left: string; right: string; screenOff: string; line: string }
function palette(dark: boolean): Palette {
  return dark
    ? { floorA: "#1c1e23", floorB: "#202228", wallLeft: "#2b2e35", wallRight: "#25282e", window: "#33404f", top: "#454953", left: "#30333a", right: "#282a30", screenOff: "#3a3e47", line: "rgba(255,255,255,0.08)" }
    : { floorA: "#eef0f3", floorB: "#e7eaee", wallLeft: "#fafbfc", wallRight: "#f1f3f6", window: "#d9e7f5", top: "#ffffff", left: "#dde1e7", right: "#cdd2da", screenOff: "#b9bfc8", line: "rgba(0,0,0,0.06)" };
}

/** World (tiles; z up) to screen points for one floor drawing. */
function projector(scale: number) {
  const ox = SIZE * COS * scale, oy = WALL * scale + 34;
  const at = (x: number, y: number, z = 0) => [ox + (x - y) * COS * scale, oy + (x + y) * 0.5 * scale - z * scale] as const;
  const points = (...corners: Array<readonly [number, number, number?]>) => corners.map(([x, y, z]) => at(x, y, z ?? 0).join(",")).join(" ");
  return { at, points, width: SIZE * 2 * COS * scale, height: oy + SIZE * scale + 52 };
}
type Projector = ReturnType<typeof projector>;

const chair = (colors: Palette) => ({ top: colors.left, left: colors.right, right: colors.right });

/** An upright box's three visible faces, back to front. */
function Box({ p, x, y, w, d, h, z = 0, colors }: { p: Projector; x: number; y: number; w: number; d: number; h: number; z?: number; colors: { top: string; left: string; right: string } }) {
  return <>
    <Polygon points={p.points([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} fill={colors.left} />
    <Polygon points={p.points([x + w, y, z], [x + w, y + d, z], [x + w, y + d, z + h], [x + w, y, z + h])} fill={colors.right} />
    <Polygon points={p.points([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} fill={colors.top} />
  </>;
}

function Shell({ p, colors }: { p: Projector; colors: Palette }) {
  const tiles = [];
  for (let i = 0; i < SIZE; i++) for (let j = 0; j < SIZE; j++)
    tiles.push(<Polygon key={`${i}-${j}`} points={p.points([i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1])} fill={(i + j) % 2 ? colors.floorA : colors.floorB} stroke={colors.line} strokeWidth={0.5} />);
  return <>
    <Polygon points={p.points([0, 0], [0, SIZE], [0, SIZE, WALL], [0, 0, WALL])} fill={colors.wallLeft} />
    <Polygon points={p.points([0, 0], [SIZE, 0], [SIZE, 0, WALL], [0, 0, WALL])} fill={colors.wallRight} />
    {[3.3, 4.6].map(y => <Polygon key={`l${y}`} points={p.points([0, y, 0.55], [0, y + 0.95, 0.55], [0, y + 0.95, 1.25], [0, y, 1.25])} fill={colors.window} />)}
    {[3.3, 4.6].map(x => <Polygon key={`r${x}`} points={p.points([x, 0, 0.55], [x + 0.95, 0, 0.55], [x + 0.95, 0, 1.25], [x, 0, 1.25])} fill={colors.window} />)}
    {tiles}
  </>;
}

/** The glow of a working monitor screen, over the desk drawing. */
function Screen({ p, x, y, color, pulse }: { p: Projector; x: number; y: number; color: string; pulse: boolean }) {
  const reducedMotion = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (!pulse || reducedMotion) { cancelAnimation(glow); glow.set(1); return; }
    glow.set(withRepeat(withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(glow);
  }, [pulse, reducedMotion, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left: 0, top: 0, width: p.width, height: p.height }, style]}>
    <Svg width={p.width} height={p.height}>
      <Polygon points={p.points([x - 0.42, y + 0.02, DESK.h + 0.08], [x + 0.42, y + 0.02, DESK.h + 0.08], [x + 0.42, y + 0.02, DESK.h + 0.62], [x - 0.42, y + 0.02, DESK.h + 0.62])} fill={color} />
    </Svg>
  </Animated.View>;
}

function Label({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return <View pointerEvents="none" style={{ position: "absolute", left: left - 55, top, width: 110, alignItems: "center", gap: 1 }}>{children}</View>;
}

const Desk = memo(function Desk({ p, slot, agent, phase, meeting, colors, onOpen }: { p: Projector; slot: { x: number; y: number }; agent: MobileAgent; phase: Phase | undefined; meeting: boolean; colors: Palette; onOpen: (agent: MobileAgent) => void }) {
  const { tr } = useDsText();
  const [success, warning, muted] = useThemeColor(["success", "warning", "muted"]);
  const avatar = Math.round(p.width / 9.5);
  const [ax, ay] = p.at(slot.x, slot.y - 0.75, 0.95);
  const [lx, ly] = p.at(slot.x + DESK.w / 2, slot.y + DESK.d / 2);
  const shown = meeting ? "idle" : phase;
  const screen = busy(shown) ? String(success) : shown === "waiting" ? String(warning) : colors.screenOff;
  const status = meeting ? tr("In a meeting") : shown === "waiting" ? tr("Waiting for you") : busy(shown) ? tr("Working") : tr("Free");
  const statusColor = meeting || busy(shown) ? String(success) : shown === "waiting" ? String(warning) : String(muted);
  const x = slot.x - DESK.w / 2, y = slot.y - DESK.d / 2;
  return <>
    {/* The Bot sits on its chair behind the desk; the chair is empty while it is away in a meeting. */}
    <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Box p={p} x={slot.x - 0.22} y={slot.y - 0.95} w={0.44} d={0.44} h={0.3} colors={chair(colors)} />
      {meeting ? <Box p={p} x={slot.x - 0.22} y={slot.y - 1.0} w={0.44} d={0.1} h={0.75} colors={chair(colors)} /> : null}
    </Svg>
    {meeting ? null : <View pointerEvents="none" style={{ position: "absolute", left: ax - avatar / 2, top: ay - avatar / 2 }}>
      <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={avatar} animateIdle={false} rings />
    </View>}
    <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Box p={p} x={x} y={y} w={DESK.w} d={DESK.d} h={DESK.h} colors={colors} />
      <Box p={p} x={slot.x - 0.08} y={slot.y - 0.12} w={0.16} d={0.1} h={0.12} z={DESK.h} colors={colors} />
      <Box p={p} x={slot.x - 0.48} y={slot.y - 0.1} w={0.96} d={0.1} h={0.62} z={DESK.h + 0.04} colors={{ top: colors.right, left: colors.right, right: colors.left }} />
    </Svg>
    <Screen p={p} x={slot.x} y={slot.y} color={screen} pulse={busy(shown)} />
    <Label left={lx} top={ly + 4}>
      <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 12.5, lineHeight: 16 }}>{agent.name}</Typography.Paragraph>
      <View className="flex-row items-center gap-1">
        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: statusColor }} />
        <Typography.Paragraph numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, color: statusColor }}>{status}</Typography.Paragraph>
      </View>
    </Label>
    <Pressable accessibilityRole="button" accessibilityLabel={`${agent.name}, ${status}`} onPress={() => { void haptics.impact("soft"); onOpen(agent); }}
      style={({ pressed }) => ({ position: "absolute", left: lx - 50, top: ay - avatar / 2, width: 100, height: ly + 36 - (ay - avatar / 2), opacity: pressed ? 0.4 : 1 })} />
  </>;
});

const MeetingRoom = memo(function MeetingRoom({ p, room, work, agents, colors, onOpen }: { p: Projector; room: ChannelSummary; work: DsWorkView | undefined; agents: ReadonlyMap<string, MobileAgent>; colors: Palette; onOpen: (room: ChannelSummary) => void }) {
  const { tr } = useDsText();
  const [success, warning, muted] = useThemeColor(["success", "warning", "muted"]);
  const live = !!work && work.phase !== "idle";
  const tint = work?.phase === "waiting" ? String(warning) : live ? String(success) : String(muted);
  // Only the members working in a running meeting are at the table; the other chairs stay empty.
  const attending = new Set((live ? work?.members ?? [] : []).filter(member => member.phase !== "idle").map(member => member.botId));
  const members = room.members.map(member => agents.get(member.agentId)).filter((agent): agent is MobileAgent => !!agent && attending.has(agent.id)).slice(0, 6);
  // Seats along the back and the front of the table; back seats are drawn before the table.
  const seats = [{ x: 0.95, y: 0.55 }, { x: 1.75, y: 0.55 }, { x: 0.95, y: 2.05 }, { x: 1.75, y: 2.05 }, { x: 0.35, y: 1.3 }, { x: 2.35, y: 1.3 }];
  const size = Math.round(p.width / 13);
  const seat = (agent: MobileAgent, index: number) => {
    const spot = seats[index], [sx, sy] = p.at(spot.x, spot.y, 0.75);
    return <View key={agent.id} pointerEvents="none" style={{ position: "absolute", left: sx - size / 2, top: sy - size / 2 }}>
      <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={size} animateIdle={false} rings />
    </View>;
  };
  const back = members.filter((_, index) => seats[index].y < 1.3 || seats[index].x < 0.5);
  const front = members.filter(agent => !back.includes(agent));
  const [tx, ty] = p.at(ROOM / 2, 0, WALL + 0.15);
  const [, by] = p.at(ROOM, ROOM);
  const status = work?.phase === "waiting" ? tr("Waiting for you") : live ? tr("In a meeting") : tr("Free");
  return <>
    <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>
      {seats.slice(0, Math.max(4, Math.min(6, room.members.length))).map((spot, index) => <Box key={index} p={p} x={spot.x - 0.2} y={spot.y - 0.2} w={0.4} d={0.4} h={0.28} colors={chair(colors)} />)}
    </Svg>
    {back.map(agent => seat(agent, members.indexOf(agent)))}
    <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Box p={p} x={0.75} y={0.95} w={1.2} d={0.8} h={0.42} colors={colors} />
    </Svg>
    {front.map(agent => seat(agent, members.indexOf(agent)))}
    {/* Glass walls in front of the room, tinted by the meeting's state. */}
    <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>
      <Polygon points={p.points([0, ROOM], [ROOM, ROOM], [ROOM, ROOM, 1.05], [0, ROOM, 1.05])} fill={tint} fillOpacity={live ? 0.16 : 0.08} stroke={tint} strokeOpacity={live ? 0.9 : 0.35} strokeWidth={1.2} />
      <Polygon points={p.points([ROOM, 0], [ROOM, ROOM], [ROOM, ROOM, 1.05], [ROOM, 0, 1.05])} fill={tint} fillOpacity={live ? 0.12 : 0.06} stroke={tint} strokeOpacity={live ? 0.9 : 0.35} strokeWidth={1.2} />
    </Svg>
    <View pointerEvents="none" style={{ position: "absolute", left: tx - 80, top: ty - 30, width: 160, alignItems: "center" }}>
      <View className="flex-row items-center gap-1.5 rounded-full bg-background px-2.5" style={{ height: 24, borderWidth: 1, borderColor: tint }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
        <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, maxWidth: 110 }}>{room.name}</Typography.Paragraph>
        <Typography.Paragraph numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, color: tint }}>{status}</Typography.Paragraph>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${room.name}, ${status}`} onPress={() => { void haptics.impact("soft"); onOpen(room); }}
      style={({ pressed }) => ({ position: "absolute", left: p.at(0, ROOM)[0], top: ty - 30, width: p.at(ROOM, 0)[0] - p.at(0, ROOM)[0], height: by - ty + 30, opacity: pressed ? 0.4 : 1 })} />
  </>;
});

/** What the floor's busy Bots are doing, in words, under the drawing. */
function Activity({ agents, work, inMeeting }: { agents: readonly MobileAgent[]; work: Readonly<Record<string, DsWorkView>>; inMeeting: ReadonlyMap<string, ChannelSummary> }) {
  const { tr } = useDsText();
  const [success, warning] = useThemeColor(["success", "warning"]);
  const lines = agents.flatMap(agent => {
    const room = inMeeting.get(agent.id), phase = work[agent.id]?.phase;
    if (room) return [{ agent, color: String(success), text: tr("In meeting room · {name}", { name: room.name }) }];
    if (phase === "waiting") return [{ agent, color: String(warning), text: tr("Waiting for you") }];
    if (busy(phase)) return [{ agent, color: String(success), text: work[agent.id]?.detail || tr("Working") }];
    return [];
  });
  if (!lines.length) return null;
  return <View style={{ gap: 6, paddingHorizontal: 6 }}>
    {lines.map(line => <View key={line.agent.id} className="flex-row items-center gap-2">
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: line.color }} />
      <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>{line.agent.name}</Typography.Paragraph>
      <Typography.Paragraph className="text-text-secondary min-w-0 flex-1" numberOfLines={1} style={{ fontSize: 13, lineHeight: 18 }}>{line.text}</Typography.Paragraph>
    </View>)}
  </View>;
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
  const { width } = useWindowDimensions();
  const dark = useUniwind().theme === "dark";
  const colors = palette(dark);
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const { inMeeting, busyDesks, meetings } = officeSeats(agents, rooms, work);
  const p = projector((Math.min(width - sideInsets.left - sideInsets.right, 520) - 24) / (SIZE * 2 * COS));
  const floors = officeFloors(agents, rooms);
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset, paddingLeft: sideInsets.left, paddingRight: sideInsets.right, gap: 10 }}>
      {header}
      <View className="flex-row items-baseline gap-3" style={{ paddingHorizontal: 20 }}>
        <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{tr("Office")}</Typography.Paragraph>
        <Typography.Paragraph className="text-muted" style={{ fontSize: 12, lineHeight: 16 }}>
          {[meetings ? tr("{count} in a meeting", { count: String(meetings) }) : null, busyDesks ? tr("{count} working", { count: String(busyDesks) }) : null].filter(Boolean).join(" · ")}
        </Typography.Paragraph>
      </View>
      {floors.map((floor, index) => (
        <View key={index} style={{ gap: 8, paddingHorizontal: 12 }}>
          {floors.length > 1 ? <Typography.Paragraph className="text-muted" style={{ fontSize: 12, lineHeight: 16, fontWeight: "700", paddingHorizontal: 8 }}>{`${index + 1}F`}</Typography.Paragraph> : null}
          <View style={{ width: p.width, height: p.height, alignSelf: "center" }}>
            <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}><Shell p={p} colors={colors} /></Svg>
            {floor.room ? <MeetingRoom p={p} room={floor.room} work={work[floor.room.id]} agents={byId} colors={colors} onOpen={onOpenRoom} /> : null}
            {floor.agents
              .map((agent, slot) => ({ agent, slot: DESK_SLOTS[slot] }))
              .sort((a, b) => a.slot.x + a.slot.y - (b.slot.x + b.slot.y))
              .map(({ agent, slot }) => <Desk key={agent.id} p={p} slot={slot} agent={agent} phase={work[agent.id]?.phase} meeting={inMeeting.has(agent.id)} colors={colors} onOpen={onOpenBot} />)}
          </View>
          <Activity agents={floor.agents} work={work} inMeeting={inMeeting} />
        </View>
      ))}
    </ScrollView>
  );
}
