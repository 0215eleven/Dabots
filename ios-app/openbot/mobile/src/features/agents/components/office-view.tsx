// DS Bot Mobile: the home's office mode, one floor seen from the front and a little above. The
// back wall is at the top with the glass meeting rooms (group chats) against it; below, every Bot
// sits behind its own desk in two columns, as far down as the team needs. A monitor glows while its
// Bot works and turns amber while it waits for you; a Bot working in a running meeting sits at that
// room's table and leaves its desk chair empty. Tapping a desk or a room opens that chat.
import type { ChannelSummary } from "@openbot/contracts/ipc";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { memo, useEffect, type ReactNode } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from "react-native-reanimated";
import Svg, { Ellipse, Line, Polygon, Rect } from "react-native-svg";
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

// The floor plan, in floor units: 6 wide, rooms two to a row against the back wall, desks in two
// columns below them. y grows towards the viewer; z is height.
const WIDTH = 6, ROOM_DEPTH = 4.4, ROW = 4.6, WALL = 1.3, DEPTH = 0.6;
const DESK = { w: 2.1, d: 0.75, h: 0.55 };
/** Rooms along the back wall and a desk for each Bot, plus the floor's depth. */
export function officeLayout(desks: number, rooms: number) {
  const roomRects = Array.from({ length: rooms }, (_, index) => {
    const row = Math.floor(index / 2), alone = rooms % 2 === 1 && index === rooms - 1;
    return { x: alone ? 0 : (index % 2) * (WIDTH / 2), y: row * ROOM_DEPTH, w: alone ? WIDTH : WIDTH / 2, d: ROOM_DEPTH };
  });
  const top = Math.ceil(rooms / 2) * ROOM_DEPTH + 0.4;
  const deskSlots = Array.from({ length: desks }, (_, index) => ({ x: (index % 2) * (WIDTH / 2) + WIDTH / 4, y: top + Math.floor(index / 2) * ROW + 2.2 }));
  return { rooms: roomRects, desks: deskSlots, depth: top + Math.ceil(desks / 2) * ROW + 0.3 };
}

interface Palette { floor: string; grid: string; wall: string; trim: string; window: string; top: string; front: string; chair: string; screenOff: string; shadow: string }
function palette(dark: boolean): Palette {
  return dark
    ? { floor: "#1d1f24", grid: "rgba(255,255,255,0.05)", wall: "#2a2d34", trim: "#353943", window: "#34404e", top: "#4a4e58", front: "#31343b", chair: "#3c4049", screenOff: "#3d414a", shadow: "rgba(0,0,0,0.45)" }
    : { floor: "#eceef2", grid: "rgba(0,0,0,0.05)", wall: "#f8f9fb", trim: "#e2e5ea", window: "#d6e6f6", top: "#ffffff", front: "#d9dde3", chair: "#c9ced6", screenOff: "#bcc2cb", shadow: "rgba(0,0,0,0.10)" };
}

/** Floor units to screen points: front-on, looking a little down, so depth is foreshortened. */
function projector(scale: number, depth: number) {
  const top = WALL * scale + 8;
  const at = (x: number, y: number, z = 0) => [x * scale, top + y * scale * DEPTH - z * scale] as const;
  const points = (...corners: Array<readonly [number, number, number?]>) => corners.map(([x, y, z]) => at(x, y, z ?? 0).join(",")).join(" ");
  return { at, points, scale, width: WIDTH * scale, height: top + depth * scale * DEPTH + 8 };
}
type Projector = ReturnType<typeof projector>;

/** A box's top and front faces. */
function Box({ p, x, y, w, d, h, z = 0, top, front }: { p: Projector; x: number; y: number; w: number; d: number; h: number; z?: number; top: string; front: string }) {
  return <>
    <Polygon points={p.points([x, y + d, z], [x + w, y + d, z], [x + w, y + d, z + h], [x, y + d, z + h])} fill={front} />
    <Polygon points={p.points([x, y, z + h], [x + w, y, z + h], [x + w, y + d, z + h], [x, y + d, z + h])} fill={top} />
  </>;
}

function Layer({ p, children }: { p: Projector; children: ReactNode }) {
  return <Svg pointerEvents="none" width={p.width} height={p.height} style={{ position: "absolute", left: 0, top: 0 }}>{children}</Svg>;
}

function Shell({ p, depth, colors }: { p: Projector; depth: number; colors: Palette }) {
  const lines = [];
  for (let x = 1; x < WIDTH; x++) lines.push(<Line key={`x${x}`} x1={p.at(x, 0)[0]} y1={p.at(x, 0)[1]} x2={p.at(x, depth)[0]} y2={p.at(x, depth)[1]} stroke={colors.grid} strokeWidth={1} />);
  for (let y = 1; y < depth; y++) lines.push(<Line key={`y${y}`} x1={0} y1={p.at(0, y)[1]} x2={p.width} y2={p.at(0, y)[1]} stroke={colors.grid} strokeWidth={1} />);
  const [, wallTop] = p.at(0, 0, WALL), [, floorTop] = p.at(0, 0);
  return <>
    <Rect x={0} y={wallTop} width={p.width} height={floorTop - wallTop} fill={colors.wall} />
    {[0.6, 2.3, 4.0].map(x => <Rect key={x} x={p.at(x, 0)[0]} y={p.at(0, 0, 1.05)[1]} width={1.4 * p.scale} height={0.6 * p.scale} rx={3} fill={colors.window} />)}
    <Rect x={0} y={floorTop - 4} width={p.width} height={4} fill={colors.trim} />
    <Rect x={0} y={floorTop} width={p.width} height={p.at(0, depth)[1] - floorTop} fill={colors.floor} />
    {lines}
  </>;
}

/** A monitor screen over the desk drawing; it pulses while the Bot works. */
function Screen({ p, x, y, z, color, pulse }: { p: Projector; x: number; y: number; z: number; color: string; pulse: boolean }) {
  const reducedMotion = useReducedMotion();
  const glow = useSharedValue(1);
  useEffect(() => {
    if (!pulse || reducedMotion) { cancelAnimation(glow); glow.set(1); return; }
    glow.set(withRepeat(withTiming(0.4, { duration: 900, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => cancelAnimation(glow);
  }, [pulse, reducedMotion, glow]);
  const style = useAnimatedStyle(() => ({ opacity: glow.get() }));
  const [left, top] = p.at(x, y, z + 0.5), [right, bottom] = p.at(x + 0.8, y, z + 0.06);
  return <Animated.View pointerEvents="none" style={[{ position: "absolute", left, top, width: right - left, height: bottom - top, borderRadius: 3, backgroundColor: color }, style]} />;
}

const Desk = memo(function Desk({ p, slot, agent, phase, meeting, colors, onOpen }: { p: Projector; slot: { x: number; y: number }; agent: MobileAgent; phase: Phase | undefined; meeting: boolean; colors: Palette; onOpen: (agent: MobileAgent) => void }) {
  const { tr } = useDsText();
  const [success, warning, muted] = useThemeColor(["success", "warning", "muted"]);
  const avatar = Math.round(p.scale * 0.85);
  const x = slot.x - DESK.w / 2, y = slot.y - DESK.d / 2;
  const [ax, ay] = p.at(slot.x + 0.45, slot.y - 0.75, 0.85);
  const [, labelTop] = p.at(slot.x, y + DESK.d);
  const shown = meeting ? "idle" : phase;
  const screen = busy(shown) ? String(success) : shown === "waiting" ? String(warning) : colors.screenOff;
  const status = meeting ? tr("In a meeting") : shown === "waiting" ? tr("Waiting for you") : busy(shown) ? tr("Working") : tr("Free");
  const statusColor = meeting || busy(shown) ? String(success) : shown === "waiting" ? String(warning) : String(muted);
  const [sx, sy] = p.at(slot.x, slot.y + DESK.d / 2);
  return <>
    <Layer p={p}>
      <Ellipse cx={sx} cy={sy + 2} rx={DESK.w * p.scale * 0.55} ry={6} fill={colors.shadow} />
      {/* The chair behind the desk; it stays empty while the Bot is away in a meeting. */}
      <Box p={p} x={slot.x + 0.15} y={slot.y - 1.05} w={0.6} d={0.45} h={0.35} top={colors.chair} front={colors.front} />
    </Layer>
    {meeting ? null : <View pointerEvents="none" style={{ position: "absolute", left: ax - avatar / 2, top: ay - avatar / 2 }}>
      <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={avatar} animateIdle={false} rings />
    </View>}
    <Layer p={p}>
      <Box p={p} x={x} y={y} w={DESK.w} d={DESK.d} h={DESK.h} top={colors.top} front={colors.front} />
      {/* The monitor stands at the desk's left, its screen facing the room. */}
      <Box p={p} x={x + 0.25} y={slot.y - 0.08} w={0.9} d={0.1} h={0.62} z={DESK.h} top={colors.chair} front={colors.chair} />
      <Box p={p} x={x + 0.62} y={slot.y - 0.08} w={0.16} d={0.2} h={0.06} z={DESK.h} top={colors.chair} front={colors.front} />
    </Layer>
    <Screen p={p} x={x + 0.3} y={slot.y + 0.02} z={DESK.h + 0.04} color={screen} pulse={busy(shown)} />
    <View pointerEvents="none" style={{ position: "absolute", left: sx - p.scale * 1.4, top: labelTop + 5, width: p.scale * 2.8, alignItems: "center", gap: 1 }}>
      <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 13, lineHeight: 17 }}>{agent.name}</Typography.Paragraph>
      <View className="flex-row items-center gap-1">
        <View style={{ width: 5, height: 5, borderRadius: 2.5, backgroundColor: statusColor }} />
        <Typography.Paragraph numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, color: statusColor }}>{status}</Typography.Paragraph>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${agent.name}, ${status}`} onPress={() => { void haptics.impact("soft"); onOpen(agent); }}
      style={({ pressed }) => ({ position: "absolute", left: sx - p.scale * 1.4, top: ay - avatar / 2, width: p.scale * 2.8, height: labelTop + 40 - (ay - avatar / 2), opacity: pressed ? 0.4 : 1 })} />
  </>;
});

const MeetingRoom = memo(function MeetingRoom({ p, rect, room, work, agents, colors, onOpen }: { p: Projector; rect: { x: number; y: number; w: number; d: number }; room: ChannelSummary; work: DsWorkView | undefined; agents: ReadonlyMap<string, MobileAgent>; colors: Palette; onOpen: (room: ChannelSummary) => void }) {
  const { tr } = useDsText();
  const [success, warning, muted] = useThemeColor(["success", "warning", "muted"]);
  const live = !!work && work.phase !== "idle";
  const tint = work?.phase === "waiting" ? String(warning) : live ? String(success) : String(muted);
  // Only the members working in a running meeting sit at the table; the other chairs stay empty.
  const attending = new Set((live ? work?.members ?? [] : []).filter(member => member.phase !== "idle").map(member => member.botId));
  const seated = room.members.map(member => agents.get(member.agentId)).filter((agent): agent is MobileAgent => !!agent && attending.has(agent.id));
  const cx = rect.x + rect.w / 2, table = { w: Math.min(rect.w - 1.2, 3.2), d: 0.8 };
  const tableY = rect.y + 2.2;
  const chairs = Math.max(2, Math.min(4, Math.floor(table.w / 0.8)));
  const chairX = (index: number) => cx - table.w / 2 + (index + 0.5) * (table.w / chairs);
  const size = Math.round(p.scale * 0.7);
  const status = work?.phase === "waiting" ? tr("Waiting for you") : live ? tr("In a meeting") : tr("Free");
  const [left, glassTop] = p.at(rect.x + 0.1, rect.y + rect.d, 0.75), [right, glassBottom] = p.at(rect.x + rect.w - 0.1, rect.y + rect.d);
  const [, carpetTop] = p.at(0, rect.y);
  const [, roomTop] = p.at(0, rect.y, 1.0);
  return <>
    <Layer p={p}>
      {/* The room's carpet and its two side walls, then the chairs behind the table. */}
      <Rect x={left} y={carpetTop} width={right - left} height={glassBottom - carpetTop} fill={tint} fillOpacity={live ? 0.08 : 0.04} />
      <Box p={p} x={rect.x + 0.02} y={rect.y} w={0.1} d={rect.d} h={0.75} top={colors.trim} front={colors.trim} />
      <Box p={p} x={rect.x + rect.w - 0.12} y={rect.y} w={0.1} d={rect.d} h={0.75} top={colors.trim} front={colors.trim} />
      {Array.from({ length: chairs }, (_, index) => <Box key={index} p={p} x={chairX(index) - 0.25} y={tableY - 0.55} w={0.5} d={0.4} h={0.32} top={colors.chair} front={colors.front} />)}
    </Layer>
    {seated.slice(0, chairs).map((agent, index) => {
      const [sx, sy] = p.at(chairX(index), tableY - 0.4, 0.75);
      return <View key={agent.id} pointerEvents="none" style={{ position: "absolute", left: sx - size / 2, top: sy - size / 2 }}>
        <BloubAvatar agentId={agent.id} serverId={agent.serverId} hue={agent.avatarHue} seed={agent.avatarSeed} size={size} animateIdle={false} rings />
      </View>;
    })}
    <Layer p={p}>
      <Box p={p} x={cx - table.w / 2} y={tableY} w={table.w} d={table.d} h={0.42} top={colors.top} front={colors.front} />
      {/* The glass front, tinted by the meeting's state. */}
      <Rect x={left} y={glassTop} width={right - left} height={glassBottom - glassTop} rx={3} fill={tint} fillOpacity={live ? 0.14 : 0.06} stroke={tint} strokeOpacity={live ? 0.9 : 0.35} strokeWidth={1.2} />
    </Layer>
    {/* The name tag hangs on the glass, at its left so the table stays in view. */}
    <View pointerEvents="none" style={{ position: "absolute", left: left + 8, top: glassTop - 12, maxWidth: right - left - 16, alignItems: "flex-start" }}>
      <View className="flex-row items-center gap-1.5 rounded-full bg-background px-2.5" style={{ height: 24, borderWidth: 1, borderColor: tint }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tint }} />
        <Typography.Paragraph className="font-semibold" numberOfLines={1} style={{ fontSize: 12, lineHeight: 16, maxWidth: 110 }}>{room.name}</Typography.Paragraph>
        <Typography.Paragraph numberOfLines={1} style={{ fontSize: 11, lineHeight: 14, color: tint }}>{status}</Typography.Paragraph>
      </View>
    </View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${room.name}, ${status}`} onPress={() => { void haptics.impact("soft"); onOpen(room); }}
      style={({ pressed }) => ({ position: "absolute", left, top: roomTop, width: right - left, height: glassBottom - roomTop, opacity: pressed ? 0.4 : 1 })} />
  </>;
});

/** What the busy Bots are doing, in words, under the floor. */
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
  return <View style={{ gap: 6, paddingHorizontal: 20 }}>
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
  const colors = palette(useUniwind().theme === "dark");
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const { inMeeting, busyDesks, meetings } = officeSeats(agents, rooms, work);
  const layout = officeLayout(agents.length, rooms.length);
  const p = projector((Math.min(width - sideInsets.left - sideInsets.right, 560) - 24) / WIDTH, layout.depth);
  return (
    <ScrollView contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingTop: topInset, paddingBottom: bottomInset, paddingLeft: sideInsets.left, paddingRight: sideInsets.right, gap: 12 }}>
      {header}
      <View className="flex-row items-baseline gap-3" style={{ paddingHorizontal: 20 }}>
        <Typography.Paragraph className="text-muted" style={{ fontSize: 13, lineHeight: 18, fontWeight: "600" }}>{tr("Office")}</Typography.Paragraph>
        <Typography.Paragraph className="text-muted" style={{ fontSize: 12, lineHeight: 16 }}>
          {[meetings ? tr("{count} in a meeting", { count: String(meetings) }) : null, busyDesks ? tr("{count} working", { count: String(busyDesks) }) : null].filter(Boolean).join(" · ")}
        </Typography.Paragraph>
      </View>
      <View className="overflow-hidden rounded-[22px]" style={{ width: p.width, height: p.height, alignSelf: "center", borderCurve: "continuous" }}>
        <Layer p={p}><Shell p={p} depth={layout.depth} colors={colors} /></Layer>
        {rooms.map((room, index) => <MeetingRoom key={room.id} p={p} rect={layout.rooms[index]} room={room} work={work[room.id]} agents={byId} colors={colors} onOpen={onOpenRoom} />)}
        {agents.map((agent, index) => <Desk key={agent.id} p={p} slot={layout.desks[index]} agent={agent} phase={work[agent.id]?.phase} meeting={inMeeting.has(agent.id)} colors={colors} onOpen={onOpenBot} />)}
      </View>
      <Activity agents={agents} work={work} inMeeting={inMeeting} />
    </ScrollView>
  );
}
